// Arabic Reshaper Test Script - Edge Cases & Mixed Text
const ARABIC_MAP = {
    0x0621: { type: 'NONE', forms: [0xFE80, 0xFE80, 0xFE80, 0xFE80] }, // Hamza
    0x0622: { type: 'RIGHT', forms: [0xFE81, 0xFE82, 0xFE82, 0xFE81] }, // Alef Madda
    0x0623: { type: 'RIGHT', forms: [0xFE83, 0xFE84, 0xFE84, 0xFE83] }, // Alef Hamza Above
    0x0624: { type: 'RIGHT', forms: [0xFE85, 0xFE86, 0xFE86, 0xFE85] }, // Waw Hamza
    0x0625: { type: 'RIGHT', forms: [0xFE87, 0xFE88, 0xFE88, 0xFE87] }, // Alef Hamza Below
    0x0626: { type: 'DUAL',  forms: [0xFE89, 0xFE8A, 0xFE8C, 0xFE8B] }, // Yeh Hamza
    0x0627: { type: 'RIGHT', forms: [0xFE8D, 0xFE8E, 0xFE8E, 0xFE8D] }, // Alef
    0x0628: { type: 'DUAL',  forms: [0xFE8F, 0xFE90, 0xFE92, 0xFE91] }, // Beh
    0x0629: { type: 'RIGHT', forms: [0xFE93, 0xFE94, 0xFE94, 0xFE93] }, // Teh Marbuta
    0x062A: { type: 'DUAL',  forms: [0xFE95, 0xFE96, 0xFE98, 0xFE97] }, // Teh
    0x062B: { type: 'DUAL',  forms: [0xFE99, 0xFE9A, 0xFE9C, 0xFE9B] }, // Theh
    0x062C: { type: 'DUAL',  forms: [0xFE9D, 0xFE9E, 0xFEA0, 0xFE9F] }, // Jeem
    0x062D: { type: 'DUAL',  forms: [0xFEA1, 0xFEA2, 0xFEA4, 0xFEA3] }, // Hah
    0x062E: { type: 'DUAL',  forms: [0xFEA5, 0xFEA6, 0xFEA8, 0xFEA7] }, // Khah
    0x062F: { type: 'RIGHT', forms: [0xFEA9, 0xFEAA, 0xFEAA, 0xFEA9] }, // Dal
    0x0630: { type: 'RIGHT', forms: [0xFEAB, 0xFEAC, 0xFEAC, 0xFEAB] }, // Thal
    0x0631: { type: 'RIGHT', forms: [0xFEAD, 0xFEAE, 0xFEAE, 0xFEAD] }, // Reh
    0x0632: { type: 'RIGHT', forms: [0xFEAF, 0xFEB0, 0xFEB0, 0xFEAF] }, // Zain
    0x0633: { type: 'DUAL',  forms: [0xFEB1, 0xFEB2, 0xFEB4, 0xFEB3] }, // Seen
    0x0634: { type: 'DUAL',  forms: [0xFEB5, 0xFEB6, 0xFEB8, 0xFEB7] }, // Sheen
    0x0635: { type: 'DUAL',  forms: [0xFEB9, 0xFEBA, 0xFEBC, 0xFEBB] }, // Sad
    0x0636: { type: 'DUAL',  forms: [0xFEBD, 0xFEBE, 0xFEC0, 0xFEBF] }, // Dad
    0x0637: { type: 'DUAL',  forms: [0xFEC1, 0xFEC2, 0xFEC4, 0xFEC3] }, // Tah
    0x0638: { type: 'DUAL',  forms: [0xFEC5, 0xFEC6, 0xFEC8, 0xFEC7] }, // Zah
    0x0639: { type: 'DUAL',  forms: [0xFEC9, 0xFECA, 0xFECC, 0xFECB] }, // Ain
    0x063A: { type: 'DUAL',  forms: [0xFECD, 0xFECE, 0xFED0, 0xFECF] }, // Ghain
    0x0640: { type: 'DUAL',  forms: [0x0640, 0x0640, 0x0640, 0x0640] }, // Tatweel
    0x0641: { type: 'DUAL',  forms: [0xFED1, 0xFED2, 0xFED4, 0xFED3] }, // Feh
    0x0642: { type: 'DUAL',  forms: [0xFED5, 0xFED6, 0xFED8, 0xFED7] }, // Qaf
    0x0643: { type: 'DUAL',  forms: [0xFED9, 0xFEDA, 0xFEDC, 0xFEDB] }, // Kaf
    0x0644: { type: 'DUAL',  forms: [0xFEDD, 0xFEDE, 0xFEE0, 0xFEDF] }, // Lam
    0x0645: { type: 'DUAL',  forms: [0xFEE1, 0xFEE2, 0xFEE4, 0xFEE3] }, // Meem
    0x0646: { type: 'DUAL',  forms: [0xFEE5, 0xFEE6, 0xFEE8, 0xFEE7] }, // Noon
    0x0647: { type: 'DUAL',  forms: [0xFEE9, 0xFEEA, 0xFEEC, 0xFEEB] }, // Heh
    0x0648: { type: 'RIGHT', forms: [0xFEED, 0xFEEE, 0xFEEE, 0xFEED] }, // Waw
    0x0649: { type: 'RIGHT', forms: [0xFEEF, 0xFEF0, 0xFEF0, 0xFEEF] }, // Alef Maksura
    0x064A: { type: 'DUAL',  forms: [0xFEF1, 0xFEF2, 0xFEF4, 0xFEF3] }, // Yeh
    0x0671: { type: 'RIGHT', forms: [0xFB50, 0xFB51, 0xFB51, 0xFB50] }, // Alef Wasla
    0x067E: { type: 'DUAL',  forms: [0xFB56, 0xFB57, 0xFB59, 0xFB58] }, // Peh
    0x0686: { type: 'DUAL',  forms: [0xFB7A, 0xFB7B, 0xFB7D, 0xFB7C] }, // Tcheh
    0x06A4: { type: 'DUAL',  forms: [0xFB6A, 0xFB6B, 0xFB6D, 0xFB6C] }, // Veh
    0x06AF: { type: 'DUAL',  forms: [0xFB92, 0xFB93, 0xFB95, 0xFB94] }, // Gaf
};

const LAM_ALEF_MAP = {
    0x0622: { isolated: 0xFEF5, final: 0xFEF6 }, // Alef Madda
    0x0623: { isolated: 0xFEF7, final: 0xFEF8 }, // Alef Hamza Above
    0x0625: { isolated: 0xFEF9, final: 0xFEFA }, // Alef Hamza Below
    0x0627: { isolated: 0xFEFB, final: 0xFEFC }, // Alef
};

function isTashkeel(code) {
    return (code >= 0x064B && code <= 0x065F) || code === 0x0670;
}

function reshapeArabicText(text) {
    if (!text || typeof text !== 'string') return text;
    if (!/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)) return text;

    let chars = Array.from(text);
    let len = chars.length;
    let result = '';

    for (let i = 0; i < len; i++) {
        let code = chars[i].charCodeAt(0);

        if (!ARABIC_MAP[code]) {
            result += chars[i];
            continue;
        }

        // Check for Lam-Alef ligature
        if (code === 0x0644 && i + 1 < len) {
            let nextCode = chars[i + 1].charCodeAt(0);
            if (LAM_ALEF_MAP[nextCode]) {
                let prevIdx = i - 1;
                while (prevIdx >= 0 && isTashkeel(chars[prevIdx].charCodeAt(0))) {
                    prevIdx--;
                }
                let prevCanJoin = false;
                if (prevIdx >= 0) {
                    let pCode = chars[prevIdx].charCodeAt(0);
                    if (ARABIC_MAP[pCode] && ARABIC_MAP[pCode].type === 'DUAL') {
                        prevCanJoin = true;
                    }
                }

                let ligCode = prevCanJoin ? LAM_ALEF_MAP[nextCode].final : LAM_ALEF_MAP[nextCode].isolated;
                result += String.fromCharCode(ligCode);
                i++; // Skip the Alef
                continue;
            }
        }

        // Find prev valid joining letter
        let prevIdx = i - 1;
        while (prevIdx >= 0 && isTashkeel(chars[prevIdx].charCodeAt(0))) {
            prevIdx--;
        }
        let prevCanJoin = false;
        if (prevIdx >= 0) {
            let pCode = chars[prevIdx].charCodeAt(0);
            if (ARABIC_MAP[pCode] && ARABIC_MAP[pCode].type === 'DUAL') {
                prevCanJoin = true;
            }
        }

        // Find next valid joining letter
        let nextIdx = i + 1;
        while (nextIdx < len && isTashkeel(chars[nextIdx].charCodeAt(0))) {
            nextIdx++;
        }
        let nextCanJoin = false;
        if (nextIdx < len) {
            let nCode = chars[nextIdx].charCodeAt(0);
            if (ARABIC_MAP[nCode] && (ARABIC_MAP[nCode].type === 'DUAL' || ARABIC_MAP[nCode].type === 'RIGHT')) {
                nextCanJoin = true;
            }
        }

        let charInfo = ARABIC_MAP[code];
        let formIndex = 0; // 0: Isolated, 1: Final, 2: Medial, 3: Initial

        if (charInfo.type === 'DUAL') {
            if (prevCanJoin && nextCanJoin) formIndex = 2; // Medial
            else if (prevCanJoin && !nextCanJoin) formIndex = 1; // Final
            else if (!prevCanJoin && nextCanJoin) formIndex = 3; // Initial
            else formIndex = 0; // Isolated
        } else if (charInfo.type === 'RIGHT') {
            if (prevCanJoin) formIndex = 1; // Final
            else formIndex = 0; // Isolated
        } else {
            formIndex = 0; // Isolated
        }

        result += String.fromCharCode(charInfo.forms[formIndex]);
    }

    return result;
}

const testStrings = [
    "Category 1 - الواحة",
    "الواحة (الرتبة الأولى)",
    "123 - السلام عليكم",
    "മലയാളം & الواحة",
    "English & Arabic - الواحة"
];

testStrings.forEach(s => {
    console.log("IN :", s);
    console.log("OUT:", reshapeArabicText(s));
    console.log("-------------------");
});
