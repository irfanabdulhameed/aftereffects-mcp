/*
 * AE MCP Live View: an AEGP plug-in that keeps a picture of the active comp in the bridge folder.
 *
 * Loop (AE idle hook, main thread):
 *   1. every 2 s re-read live/options.json and write live/status.json
 *   2. watch the active comp: which comp, the playhead, and AEGP_HasItemChangedSinceTimestamp for edits
 *   3. once nothing has changed for settleMs (so never during playback or scrubbing), draw a quick
 *      small picture, then the full-size one if the quick one shows it fits in budgetMs
 *   4. write live/latest.jpg and live/latest.json atomically (temp file + rename)
 *
 * Why the quick picture first: the SDK renders whole comps only synchronously on the UI thread (async
 * exists for single layers), and AE ignores the cancel callback for comp renders (measured 27 Oct: a
 * 3.7 s frame ran to the end). The only way to keep AE responsive is to never start a frame that will
 * be slow, so the quick picture measures the frame before the full one is attempted.
 */

#include "AEConfig.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "AEGP_SuiteHandler.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>
#include <vector>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO_FALLBACK
#include "stb_image_write.h"

#ifdef AE_OS_WIN
#include <windows.h>
#define LV_EXPORT extern "C" __declspec(dllexport)
#else
#include <sys/stat.h>
#define LV_EXPORT extern "C" __attribute__((visibility("default")))
#endif

#define LV_VERSION "0.2.1"

namespace {

struct Options {
    bool enabled = true;
    int scale = 2;           /* full-size picture: 1 full, 2 half, 4 quarter */
    double maxFps = 4.0;     /* at most this many new pictures per second */
    double budgetMs = 400;   /* never start a full-size frame expected to take longer */
    double settleMs = 250;   /* wait until nothing changed for this long */
    int quality = 80;        /* JPEG quality */
};

struct State {
    SPBasicSuite *pica = nullptr;
    AEGP_PluginID id = 0;
    std::string bridgeDir;
    std::string liveDir;
    Options opts;

    double lastOptionsMs = -1e9;
    double lastStatusMs = -1e9;
    double lastRenderMs = -1e9;

    /* What the comp looks like now: bumped to a new seq whenever it changes. */
    bool haveObs = false;
    A_long obsItemId = -1;
    A_Time obsTime = {0, 1};
    AEGP_TimeStamp obsStamp = {};
    double obsChangedAt = 0;
    long obsSeq = 0;

    /* What latest.jpg shows. */
    long shownSeq = -1;
    int shownScale = 0;
    bool upgradeSkipped = false;

    /* Per comp: quick pictures get smaller when even they run over budget. */
    A_long costItemId = -1;
    int quickScale = 4;

    long frames = 0;
    long skippedUpgrades = 0;
    double lastRenderTookMs = 0;
    std::string lastError;
};

State *g = nullptr;

double nowMs() {
    using namespace std::chrono;
    return (double)duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string isoNow() {
    std::time_t t = std::time(nullptr);
    char buf[32];
    std::tm tmv;
#ifdef AE_OS_WIN
    gmtime_s(&tmv, &t);
#else
    gmtime_r(&t, &tmv);
#endif
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return buf;
}

std::string envOr(const char *name, const std::string &fallback) {
    const char *v = std::getenv(name);
    return (v && *v) ? std::string(v) : fallback;
}

std::string defaultBridgeDir() {
#ifdef AE_OS_WIN
    std::string home = envOr("USERPROFILE", "C:");
#else
    std::string home = envOr("HOME", "/tmp");
#endif
    return envOr("AE_MCP_BRIDGE_DIR", home + "/Documents/ae-mcp-bridge");
}

void makeDir(const std::string &path) {
#ifdef AE_OS_WIN
    CreateDirectoryA(path.c_str(), nullptr);
#else
    mkdir(path.c_str(), 0755);
#endif
}

bool readFile(const std::string &path, std::string &out) {
    FILE *f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    char buf[4096];
    size_t n;
    out.clear();
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    std::fclose(f);
    return true;
}

/* Temp file + rename, so a reader never sees half a file. */
bool writeAtomic(const std::string &path, const void *data, size_t size) {
    std::string tmp = path + ".tmp";
    FILE *f = std::fopen(tmp.c_str(), "wb");
    if (!f) return false;
    bool ok = std::fwrite(data, 1, size, f) == size;
    ok = (std::fclose(f) == 0) && ok;
    if (!ok) { std::remove(tmp.c_str()); return false; }
#ifdef AE_OS_WIN
    return MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
#else
    return std::rename(tmp.c_str(), path.c_str()) == 0;
#endif
}

bool writeTextAtomic(const std::string &path, const std::string &text) {
    return writeAtomic(path, text.data(), text.size());
}

std::string jsonEscape(const std::string &s) {
    std::string out;
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
                else out += (char)c;
        }
    }
    return out;
}

/* Reads one flat number/boolean key from a small JSON object. */
bool findKey(const std::string &obj, const char *key, std::string &value) {
    std::string needle = std::string("\"") + key + "\"";
    size_t p = obj.find(needle);
    if (p == std::string::npos) return false;
    p = obj.find(':', p + needle.size());
    if (p == std::string::npos) return false;
    p++;
    while (p < obj.size() && (obj[p] == ' ' || obj[p] == '\t' || obj[p] == '\n' || obj[p] == '\r')) p++;
    size_t e = p;
    while (e < obj.size() && obj[e] != ',' && obj[e] != '}' && obj[e] != '\n') e++;
    value = obj.substr(p, e - p);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\r' || value.back() == '\t')) value.pop_back();
    return !value.empty();
}

double clampD(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* live/options.json: { "enabled": true, "scale": 2, "maxFps": 4, "budgetMs": 400, "settleMs": 250, "quality": 80 } */
void loadOptions() {
    Options o;
    std::string text, v;
    if (readFile(g->liveDir + "/options.json", text)) {
        if (findKey(text, "enabled", v)) o.enabled = (v != "false");
        if (findKey(text, "scale", v)) {
            int s = std::atoi(v.c_str());
            o.scale = (s >= 4) ? 4 : (s >= 2 ? 2 : 1);
        }
        if (findKey(text, "maxFps", v)) o.maxFps = clampD(std::atof(v.c_str()), 0.2, 30);
        if (findKey(text, "budgetMs", v)) o.budgetMs = clampD(std::atof(v.c_str()), 50, 1500);
        if (findKey(text, "settleMs", v)) o.settleMs = clampD(std::atof(v.c_str()), 0, 5000);
        if (findKey(text, "quality", v)) o.quality = (int)clampD(std::atof(v.c_str()), 30, 95);
    }
    g->opts = o;
}

void writeStatus() {
    char buf[1024];
    std::snprintf(buf, sizeof buf,
        "{\"at\":\"%s\",\"plugin\":\"AE MCP Live View\",\"version\":\"%s\",\"enabled\":%s,"
        "\"scale\":%d,\"quickScale\":%d,\"maxFps\":%.2f,\"budgetMs\":%.0f,\"settleMs\":%.0f,"
        "\"frames\":%ld,\"skippedUpgrades\":%ld,\"lastRenderMs\":%.1f,\"lastError\":\"%s\"}",
        isoNow().c_str(), LV_VERSION, g->opts.enabled ? "true" : "false",
        g->opts.scale, g->quickScale, g->opts.maxFps, g->opts.budgetMs, g->opts.settleMs,
        g->frames, g->skippedUpgrades, g->lastRenderTookMs, jsonEscape(g->lastError).c_str());
    writeTextAtomic(g->liveDir + "/status.json", buf);
}

std::string utf16ToUtf8(const A_UTF16Char *s) {
    std::string out;
    if (!s) return out;
    for (size_t i = 0; s[i]; i++) {
        unsigned int c = s[i];
        if (c >= 0xD800 && c <= 0xDBFF && s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
            c = 0x10000 + ((c - 0xD800) << 10) + (s[i + 1] - 0xDC00);
            i++;
        }
        if (c < 0x80) out += (char)c;
        else if (c < 0x800) { out += (char)(0xC0 | (c >> 6)); out += (char)(0x80 | (c & 0x3F)); }
        else if (c < 0x10000) { out += (char)(0xE0 | (c >> 12)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
        else { out += (char)(0xF0 | (c >> 18)); out += (char)(0x80 | ((c >> 12) & 0x3F)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
    }
    return out;
}

std::string itemName(AEGP_SuiteHandler &suites, AEGP_ItemH itemH) {
    AEGP_MemHandle nameH = nullptr;
    std::string name;
    if (suites.ItemSuite9()->AEGP_GetItemName(g->id, itemH, &nameH) == A_Err_NONE && nameH) {
        A_UTF16Char *p = nullptr;
        if (suites.MemorySuite1()->AEGP_LockMemHandle(nameH, (void **)&p) == A_Err_NONE) {
            name = utf16ToUtf8(p);
            suites.MemorySuite1()->AEGP_UnlockMemHandle(nameH);
        }
        suites.MemorySuite1()->AEGP_FreeMemHandle(nameH);
    }
    return name;
}

void jpegToVector(void *ctx, void *data, int size) {
    auto *v = static_cast<std::vector<unsigned char> *>(ctx);
    auto *b = static_cast<unsigned char *>(data);
    v->insert(v->end(), b, b + size);
}

bool sameTime(const A_Time &a, const A_Time &b) {
    return (double)a.value * b.scale == (double)b.value * a.scale;
}

/* Renders the comp at `time` and `scale`, writes latest.jpg + latest.json, returns the render time in ms (< 0 on error). */
double renderFrame(AEGP_SuiteHandler &suites, AEGP_ItemH itemH, A_long itemId, const A_Time &time, A_FpLong fps,
                   int scale, bool final)
{
    A_Err err = A_Err_NONE;
    AEGP_RenderOptionsH optsH = nullptr;
    AEGP_FrameReceiptH receiptH = nullptr;
    double started = nowMs();
    double took = -1;

    ERR(suites.RenderOptionsSuite3()->AEGP_NewFromItem(g->id, itemH, &optsH));
    ERR(suites.RenderOptionsSuite3()->AEGP_SetTime(optsH, time));
    ERR(suites.RenderOptionsSuite3()->AEGP_SetWorldType(optsH, AEGP_WorldType_8));
    ERR(suites.RenderOptionsSuite3()->AEGP_SetDownsampleFactor(optsH, (A_short)scale, (A_short)scale));
    ERR(suites.RenderSuite5()->AEGP_RenderAndCheckoutFrame(optsH, nullptr, nullptr, &receiptH));
    took = nowMs() - started;

    if (!err && receiptH) {
        AEGP_WorldH worldH = nullptr;
        A_long w = 0, h = 0;
        A_u_long rowBytes = 0;
        PF_Pixel8 *base = nullptr;
        ERR(suites.RenderSuite5()->AEGP_GetReceiptWorld(receiptH, &worldH));
        ERR(suites.WorldSuite3()->AEGP_GetSize(worldH, &w, &h));
        ERR(suites.WorldSuite3()->AEGP_GetRowBytes(worldH, &rowBytes));
        ERR(suites.WorldSuite3()->AEGP_GetBaseAddr8(worldH, &base));
        if (!err && base && w > 0 && h > 0) {
            /* Rendered worlds are premultiplied ARGB, so dropping alpha gives the comp over black. */
            std::vector<unsigned char> rgb((size_t)w * h * 3);
            for (A_long y = 0; y < h; y++) {
                const PF_Pixel8 *row = (const PF_Pixel8 *)((const char *)base + (size_t)y * rowBytes);
                unsigned char *dst = &rgb[(size_t)y * w * 3];
                for (A_long x = 0; x < w; x++) {
                    dst[x * 3 + 0] = row[x].red;
                    dst[x * 3 + 1] = row[x].green;
                    dst[x * 3 + 2] = row[x].blue;
                }
            }
            std::vector<unsigned char> jpg;
            jpg.reserve(rgb.size() / 8);
            if (stbi_write_jpg_to_func(jpegToVector, &jpg, w, h, 3, rgb.data(), g->opts.quality) && !jpg.empty()) {
                writeAtomic(g->liveDir + "/latest.jpg", jpg.data(), jpg.size());
                g->frames++;
                g->lastRenderTookMs = took;
                g->lastError.clear();

                double seconds = time.scale ? (double)time.value / (double)time.scale : 0.0;
                char meta[1024];
                std::snprintf(meta, sizeof meta,
                    "{\"at\":\"%s\",\"comp\":\"%s\",\"itemId\":%ld,\"time\":%.6f,\"frame\":%ld,\"fps\":%.4f,"
                    "\"width\":%ld,\"height\":%ld,\"scale\":%d,\"final\":%s,\"renderMs\":%.1f,\"seq\":%ld,"
                    "\"frames\":%ld,\"file\":\"latest.jpg\"}",
                    isoNow().c_str(), jsonEscape(itemName(suites, itemH)).c_str(), (long)itemId, seconds,
                    (long)std::floor(seconds * fps + 0.5), fps, (long)w, (long)h, scale, final ? "true" : "false",
                    took, g->obsSeq, g->frames);
                writeTextAtomic(g->liveDir + "/latest.json", meta);
            } else {
                g->lastError = "JPEG encode failed";
                took = -1;
            }
        } else {
            took = -1;
        }
        suites.RenderSuite5()->AEGP_CheckinFrame(receiptH);
    } else {
        took = -1;
    }
    if (optsH) suites.RenderOptionsSuite3()->AEGP_Dispose(optsH);
    if (err) {
        char b[64];
        std::snprintf(b, sizeof b, "render error %d", (int)err);
        g->lastError = b;
    }
    return took;
}

A_Err tick(A_long *max_sleepPL) {
    AEGP_SuiteHandler suites(g->pica);
    double now = nowMs();

    if (now - g->lastOptionsMs > 2000) { g->lastOptionsMs = now; loadOptions(); }
    if (now - g->lastStatusMs > 2000) { g->lastStatusMs = now; writeStatus(); }
    if (!g->opts.enabled) return A_Err_NONE;
    if (max_sleepPL && *max_sleepPL > 6) *max_sleepPL = 6;   /* AE counts sleep in 1/60 s: wake every 100 ms */

    AEGP_ItemH itemH = nullptr;
    AEGP_ItemType type = AEGP_ItemType_NONE;
    if (suites.ItemSuite9()->AEGP_GetActiveItem(&itemH) != A_Err_NONE || !itemH) return A_Err_NONE;
    if (suites.ItemSuite9()->AEGP_GetItemType(itemH, &type) != A_Err_NONE || type != AEGP_ItemType_COMP) return A_Err_NONE;

    A_long itemId = 0;
    A_Time time = {0, 1};
    AEGP_CompH compH = nullptr;
    A_FpLong fps = 0;
    suites.ItemSuite9()->AEGP_GetItemID(itemH, &itemId);
    suites.ItemSuite9()->AEGP_GetItemCurrentTime(itemH, &time);
    if (suites.CompSuite11()->AEGP_GetCompFromItem(itemH, &compH) == A_Err_NONE && compH) {
        suites.CompSuite11()->AEGP_GetCompFramerate(compH, &fps);
    }

    /* 1. Observe. Any change starts a new seq and restarts the settle wait. */
    bool changed = !g->haveObs || itemId != g->obsItemId || !sameTime(time, g->obsTime);
    if (!changed) {
        A_Time frameDur = {1, (A_u_long)(fps > 0 ? std::lround(fps) : 30)};
        A_Boolean dirty = FALSE;
        suites.RenderSuite5()->AEGP_HasItemChangedSinceTimestamp(itemH, &time, &frameDur, &g->obsStamp, &dirty);
        changed = dirty != FALSE;
    }
    if (changed) {
        g->haveObs = true;
        g->obsItemId = itemId;
        g->obsTime = time;
        suites.RenderSuite5()->AEGP_GetCurrentTimestamp(&g->obsStamp);
        g->obsChangedAt = now;
        g->obsSeq++;
        g->upgradeSkipped = false;
        return A_Err_NONE;
    }
    if (now - g->obsChangedAt < g->opts.settleMs) return A_Err_NONE;

    if (itemId != g->costItemId) { g->costItemId = itemId; g->quickScale = 4; }
    int target = g->opts.scale;
    int quick = g->quickScale > target ? g->quickScale : target;

    /* 2. A new state: the quick picture (or the full one when it is already as small). */
    if (g->shownSeq != g->obsSeq) {
        if (now - g->lastRenderMs < 1000.0 / g->opts.maxFps) return A_Err_NONE;
        g->lastRenderMs = now;
        double took = renderFrame(suites, itemH, itemId, time, fps, quick, quick == target);
        if (took < 0) return A_Err_NONE;
        g->shownSeq = g->obsSeq;
        g->shownScale = quick;
        /* Even the quick picture ran long: make the next quick one smaller; recover when fast again. */
        if (took > g->opts.budgetMs && g->quickScale < 8) g->quickScale *= 2;
        else if (took < g->opts.budgetMs / 8 && g->quickScale > 4) g->quickScale /= 2;
        if (quick > target) {
            /* Pixels grow with the square of the size step, but effect-heavy frames grow less: measured
               27 Oct on a heavy comp, a quarter -> half step cost ~2x, not 4x. Exponent 1.5 = 2.8x per step. */
            double estimate = took * std::pow((double)quick / (double)target, 1.5);
            if (estimate > g->opts.budgetMs) { g->upgradeSkipped = true; g->skippedUpgrades++; }
        }
        return A_Err_NONE;
    }

    /* 3. Same state, shown small: the full-size picture, straight away. */
    if (g->shownScale > target && !g->upgradeSkipped) {
        g->lastRenderMs = now;
        double took = renderFrame(suites, itemH, itemId, time, fps, target, true);
        if (took >= 0) g->shownScale = target;
        else g->upgradeSkipped = true;
    }
    return A_Err_NONE;
}

A_Err IdleHook(AEGP_GlobalRefcon, AEGP_IdleRefcon, A_long *max_sleepPL) {
    try {
        return tick(max_sleepPL);
    } catch (...) {
        if (g) g->lastError = "exception in idle hook";
        return A_Err_NONE;
    }
}

A_Err DeathHook(AEGP_GlobalRefcon, AEGP_DeathRefcon) {
    delete g;
    g = nullptr;
    return A_Err_NONE;
}

} // namespace

void AEGP_SuiteHandler::MissingSuiteError() const {
    throw A_Err_MISSING_SUITE;
}

LV_EXPORT A_Err EntryPointFunc(struct SPBasicSuite *pica_basicP, A_long, A_long,
                               AEGP_PluginID aegp_plugin_id, AEGP_GlobalRefcon *)
{
    try {
        g = new State();
        g->pica = pica_basicP;
        g->id = aegp_plugin_id;
        g->bridgeDir = defaultBridgeDir();
        g->liveDir = g->bridgeDir + "/live";
        makeDir(g->bridgeDir);
        makeDir(g->liveDir);
        loadOptions();

        AEGP_SuiteHandler suites(pica_basicP);
        A_Err err = A_Err_NONE;
        ERR(suites.RegisterSuite5()->AEGP_RegisterIdleHook(aegp_plugin_id, IdleHook, nullptr));
        ERR(suites.RegisterSuite5()->AEGP_RegisterDeathHook(aegp_plugin_id, DeathHook, nullptr));
        writeStatus();
        return err;
    } catch (...) {
        return A_Err_GENERIC;
    }
}
