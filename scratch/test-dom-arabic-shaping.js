const NodeFilter = { SHOW_TEXT: 4 };

var charsMap = [
    /* code,isolated,initial, medial, final */
    [ 0x0621, 0xFE80, null  , null  , null   ], /* HAMZA */
    [ 0x0622, 0xFE81, null  , null  , 0xFE82 ], /* ALEF_MADDA */
    [ 0x0623, 0xFE83, null  , null  , 0xFE84 ], /* ALEF_HAMZA_ABOVE */
    [ 0x0624, 0xFE85, null  , null  , 0xFE86 ], /* WAW_HAMZA */
    [ 0x0625, 0xFE87, null  , null  , 0xFE88 ], /* ALEF_HAMZA_BELOW */
    [ 0x0626, 0xFE89, 0xFE8B, 0xFE8C, 0xFE8A ], /* YEH_HAMZA */
    [ 0x0627, 0xFE8D, null  , null  , 0xFE8E ], /* ALEF */
    [ 0x0628, 0xFE8F, 0xFE91, 0xFE92, 0xFE90 ], /* BEH */
    [ 0x0629, 0xFE93, null  , null  , 0xFE94 ], /* TEH_MARBUTA */
    [ 0x062A, 0xFE95, 0xFE97, 0xFE98, 0xFE96 ], /* TEH */
    [ 0x062B, 0xFE99, 0xFE9B, 0xFE9C, 0xFE9A ], /* THEH */
    [ 0x062C, 0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E ], /* JEEM */
    [ 0x062D, 0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2 ], /* HAH */
    [ 0x062E, 0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6 ], /* KHAH */
    [ 0x062F, 0xFEA9, null  , null  , 0xFEAA ], /* DAL */
    [ 0x0630, 0xFEAB, null  , null  , 0xFEAC ], /* THAL */
    [ 0x0631, 0xFEAD, null  , null  , 0xFEAE ], /* REH */
    [ 0x0632, 0xFEAF, null  , null  , 0xFEB0 ], /* ZAIN */
    [ 0x0698, 0xFB8A, null  , null  , 0xFB8B ], /* ZHEH */
    [ 0x0633, 0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2 ], /* SEEN */
    [ 0x0634, 0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6 ], /* SHEEN */
    [ 0x0635, 0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA ], /* SAD */
    [ 0x0636, 0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE ], /* DAD */
    [ 0x0637, 0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2 ], /* TAH */
    [ 0x0638, 0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6 ], /* ZAH */
    [ 0x0639, 0xFEC9, 0xFECB, 0xFECC, 0xFECA ], /* AIN */
    [ 0x063A, 0xFECD, 0xFECF, 0xFED0, 0xFECE ], /* GHAIN */
    [ 0x0640, 0x0640, 0x0640, 0x0640, 0x0640 ], /* TATWEEL */
    [ 0x0641, 0xFED1, 0xFED3, 0xFED4, 0xFED2 ], /* FEH */
    [ 0x0642, 0xFED5, 0xFED7, 0xFED8, 0xFED6 ], /* QAF */
    [ 0x0643, 0xFED9, 0xFEDB, 0xFEDC, 0xFEDA ], /* KAF */
    [ 0x0644, 0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE ], /* LAM */
    [ 0x0645, 0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2 ], /* MEEM */
    [ 0x0646, 0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6 ], /* NOON */
    [ 0x0647, 0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA ], /* HEH */
    [ 0x0648, 0xFEED, null  , null  , 0xFEEE ], /* WAW */
    [ 0x0649, 0xFEEF, 0xFBE8, 0xFBE9, 0xFEF0 ], /* ALEF_MAKSURA */
    [ 0x064A, 0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2 ], /* YEH Arabic */
    [ 0x06CC, 0xFBFC, 0xFBFE, 0xFBFF, 0xFEF0 ], /* YEH Farsi */
    [ 0x0686, 0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B ], /* CHEH */
    [ 0x067E, 0xFB56, 0xFB58, 0xFB59, 0xFB57 ],
    [ 0x06AF, 0xFB92, 0xFB94, 0xFB95, 0xFB93 ],
    [ 0x06A9, 0xFB8E, 0xFB90, 0xFB91, 0xFB8F ]
];
var combCharsMap = [
    [ [ 0x0644, 0x0622 ], 0xFEF5, null, null, 0xFEF6 ], /* LAM_ALEF_MADDA */
    [ [ 0x0644, 0x0623 ], 0xFEF7, null, null, 0xFEF8 ], /* LAM_ALEF_HAMZA_ABOVE */
    [ [ 0x0644, 0x0625 ], 0xFEF9, null, null, 0xFEFA ], /* LAM_ALEF_HAMZA_BELOW */
    [ [ 0x0644, 0x0627 ], 0xFEFB, null, null, 0xFEFC ]  /* LAM_ALEF */
];
var transChars = [
    0x0610, 0x0612, 0x0613, 0x0614, 0x0615, 0x064B, 0x064C, 0x064D, 0x064E, 0x064F,
    0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655, 0x0656, 0x0657, 0x0658, 0x0670,
    0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1,
    0x06E2, 0x06E3, 0x06E4, 0x06E7, 0x06E8, 0x06EA, 0x06EB, 0x06EC, 0x06ED
];

function CharacterMapContains(c) {
    for (var i = 0; i < charsMap.length; ++i)
        if (charsMap[i][0] == c) return true;
    return false;
}

function GetCharRep(c) {
    for (var i = 0; i < charsMap.length; ++i)
        if (charsMap[i][0] == c) return charsMap[i];
    return false;
}

function GetCombCharRep(c1, c2) {
    for (var i = 0; i < combCharsMap.length; ++i)
        if (combCharsMap[i][0][0] == c1 && combCharsMap[i][0][1] == c2) return combCharsMap[i];
    return false;
}

function IsTransparent(c) {
    for (var i = 0; i < transChars.length; ++i)
        if (transChars[i] == c) return true;
    return false;
}

function convertArabic(normal) {
    if (!normal || typeof normal !== 'string') return normal;
    var crep, combcrep, shaped = "";
    for (var i = 0; i < normal.length; ++i) {
        var current = normal.charCodeAt(i);
        if (CharacterMapContains(current)) {
            var prev = null, next = null, prevID = i - 1, nextID = i + 1;
            for (; prevID >= 0; --prevID) {
                if (!IsTransparent(normal.charCodeAt(prevID))) break;
            }
            prev = (prevID >= 0) ? normal.charCodeAt(prevID) : null;
            crep = prev ? GetCharRep(prev) : false;
            if (!crep || (crep[2] == null && crep[3] == null)) prev = null;

            for (; nextID < normal.length; ++nextID) {
                if (!IsTransparent(normal.charCodeAt(nextID))) break;
            }
            next = (nextID < normal.length) ? normal.charCodeAt(nextID) : null;
            crep = next ? GetCharRep(next) : false;
            if (!crep || (crep[3] == null && crep[4] == null)) next = null;

            if (current == 0x0644 && next != null &&
                (next == 0x0622 || next == 0x0623 || next == 0x0625 || next == 0x0627)) {
                combcrep = GetCombCharRep(current, next);
                if (combcrep) {
                    if (prev != null) {
                        shaped += String.fromCharCode(combcrep[4]);
                    } else {
                        shaped += String.fromCharCode(combcrep[1]);
                    }
                    i = i + 1;
                    continue;
                }
            }
            crep = GetCharRep(current);
            if (prev != null && next != null && crep[3] != null) {
                shaped += String.fromCharCode(crep[3]);
                continue;
            } else if (prev != null && crep[4] != null) {
                shaped += String.fromCharCode(crep[4]);
                continue;
            } else if (next != null && crep[2] != null) {
                shaped += String.fromCharCode(crep[2]);
                continue;
            } else {
                shaped += String.fromCharCode(crep[1]);
            }
        } else {
            shaped += String.fromCharCode(current);
        }
    }
    return shaped;
}

const testItems = [
    { type: 'Arabic 1 (الواحة)', text: "الواحة", expected: "ﺍﻟﻮﺍﺣﺔ" },
    { type: 'Arabic 2 (نور على نور)', text: "نور على نور", expected: "ﻧﻮﺭ ﻋﻠﻰ ﻧﻮﺭ" },
    { type: 'Arabic 3 (بسم الله الرحمن الرحيم)', text: "بسم الله الرحمن الرحيم", expected: "ﺑﺴﻢ ﺍﻟﻠﻪ ﺍﻟﺮﺣﻤﻦ ﺍﻟﺮﺣﻴﻢ" },
    { type: 'Arabic 4 (الحمد لله رب العالمين)', text: "الحمد لله رب العالمين", expected: "ﺍﻟﺤﻤﺪ ﻟﻠﻪ ﺭﺏ ﺍﻟﻌﺎﻟﻤﻴﻦ" },
    { type: 'English', text: "Category 1 - Winner Announcement", expected: "Category 1 - Winner Announcement" },
    { type: 'Malayalam', text: "മത്സര ഫലങ്ങൾ 2026", expected: "മത്സര ഫലങ്ങൾ 2026" },
    { type: 'Numbers & Symbols', text: "1st Rank (100/100) 🏆 #1", expected: "1st Rank (100/100) 🏆 #1" },
    { type: 'Mixed', text: "Category 1 - الواحة", expected: "Category 1 - ﺍﻟﻮﺍﺣﺔ" }
];

let allPassed = true;

testItems.forEach(item => {
    let result = item.text;
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    if (arabicRegex.test(result)) {
        result = convertArabic(result);
    }

    const passed = result === item.expected;
    if (!passed) allPassed = false;
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${item.type}:`);
    console.log(`  INPUT : "${item.text}"`);
    console.log(`  OUTPUT: "${result}"`);
    console.log("-----------------------------------------");
});

if (allPassed) {
    console.log("\nALL TESTS PASSED PERFECTLY!");
} else {
    console.log("\nSOME TESTS FAILED.");
    process.exit(1);
}
