const { ArabicShaper } = require('arabic-persian-reshaper');

const requiredWords = [
    "الواحة",
    "نور على نور",
    "بسم الله الرحمن الرحيم",
    "الحمد لله رب العالمين"
];

requiredWords.forEach(w => {
    console.log("RAW :", w);
    console.log("SHAPED:", ArabicShaper.convertArabic(w));
    console.log("-------------------");
});
