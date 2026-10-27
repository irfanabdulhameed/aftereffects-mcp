/* PiPL resource: tells After Effects this is an AEGP and where its entry point is. */
#include "AEConfig.h"
#include "AE_EffectVers.h"

#ifndef AE_OS_WIN
    #include "AE_General.r"
#endif

resource 'PiPL' (16000) {
    {
        Kind { AEGP },
        Name { "AE MCP Live View" },
        Category { "General Plugin" },
        Version { 65536 },
#ifdef AE_OS_WIN
    #if defined(AE_PROC_ARM64)
        CodeWinARM64 { "EntryPointFunc" },
    #else
        CodeWin64X86 { "EntryPointFunc" },
    #endif
#else
        CodeMacIntel64 { "EntryPointFunc" },
        CodeMacARM64 { "EntryPointFunc" },
#endif
    }
};
