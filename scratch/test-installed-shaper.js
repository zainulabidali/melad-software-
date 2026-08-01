const { ArabicShaper } = require('arabic-persian-reshaper');

const testStrings = [
    "الواحة",
    "السلام",
    "محمد",
    "Category 1 - الواحة",
    "الواحة (الرتبة الأولى)",
    "123 - السلام عليكم",
    "മലയാളം & الواحة",
    "English & Arabic - الواحة"
];

testStrings.forEach(s => {
    console.log("IN :", s);
    console.log("OUT:", ArabicShaper.convertArabic(s));
    console.log("-------------------");
});
