/*
 * ECMAScript 3 polyfills for the ExtendScript engine inside After Effects.
 * Loaded before everything else in the assembled bridge panel.
 * Only adds what is missing, so newer engines keep their native versions.
 */

if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (search, fromIndex) {
        var len = this.length >>> 0;
        var i = (fromIndex === undefined) ? 0 : Number(fromIndex);
        if (i < 0) { i = Math.max(0, len + i); }
        for (; i < len; i++) {
            if (i in this && this[i] === search) { return i; }
        }
        return -1;
    };
}

if (!Array.prototype.lastIndexOf) {
    Array.prototype.lastIndexOf = function (search) {
        for (var i = this.length - 1; i >= 0; i--) {
            if (i in this && this[i] === search) { return i; }
        }
        return -1;
    };
}

if (!Array.prototype.forEach) {
    Array.prototype.forEach = function (fn, thisArg) {
        for (var i = 0, len = this.length; i < len; i++) {
            if (i in this) { fn.call(thisArg, this[i], i, this); }
        }
    };
}

if (!Array.prototype.map) {
    Array.prototype.map = function (fn, thisArg) {
        var out = [];
        for (var i = 0, len = this.length; i < len; i++) {
            if (i in this) { out[i] = fn.call(thisArg, this[i], i, this); }
        }
        return out;
    };
}

if (!Array.prototype.filter) {
    Array.prototype.filter = function (fn, thisArg) {
        var out = [];
        for (var i = 0, len = this.length; i < len; i++) {
            if (i in this && fn.call(thisArg, this[i], i, this)) { out.push(this[i]); }
        }
        return out;
    };
}

if (!Array.prototype.some) {
    Array.prototype.some = function (fn, thisArg) {
        for (var i = 0, len = this.length; i < len; i++) {
            if (i in this && fn.call(thisArg, this[i], i, this)) { return true; }
        }
        return false;
    };
}

if (!Array.prototype.every) {
    Array.prototype.every = function (fn, thisArg) {
        for (var i = 0, len = this.length; i < len; i++) {
            if (i in this && !fn.call(thisArg, this[i], i, this)) { return false; }
        }
        return true;
    };
}

if (!Array.prototype.reduce) {
    Array.prototype.reduce = function (fn, initial) {
        var i = 0, len = this.length, acc;
        if (arguments.length >= 2) {
            acc = initial;
        } else {
            while (i < len && !(i in this)) { i++; }
            if (i >= len) { throw new Error("Reduce of empty array with no initial value"); }
            acc = this[i++];
        }
        for (; i < len; i++) {
            if (i in this) { acc = fn(acc, this[i], i, this); }
        }
        return acc;
    };
}

if (!Array.isArray) {
    Array.isArray = function (value) {
        return Object.prototype.toString.call(value) === "[object Array]" || value instanceof Array;
    };
}

if (!Object.keys) {
    Object.keys = function (obj) {
        var keys = [];
        if (obj === null || obj === undefined) { return keys; }
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) { keys.push(k); }
        }
        return keys;
    };
}

if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return String(this).replace(/^\s+|\s+$/g, "");
    };
}

if (!Function.prototype.bind) {
    Function.prototype.bind = function (thisArg) {
        var fn = this;
        var bound = Array.prototype.slice.call(arguments, 1);
        return function () {
            return fn.apply(thisArg, bound.concat(Array.prototype.slice.call(arguments)));
        };
    };
}

if (!Date.prototype.toISOString) {
    Date.prototype.toISOString = function () {
        function pad(n, w) {
            var s = String(n);
            while (s.length < (w || 2)) { s = "0" + s; }
            return s;
        }
        return this.getUTCFullYear() + "-" + pad(this.getUTCMonth() + 1) + "-" + pad(this.getUTCDate()) +
            "T" + pad(this.getUTCHours()) + ":" + pad(this.getUTCMinutes()) + ":" + pad(this.getUTCSeconds()) +
            "." + pad(this.getUTCMilliseconds(), 3) + "Z";
    };
}

if (!Date.now) {
    Date.now = function () { return new Date().getTime(); };
}
