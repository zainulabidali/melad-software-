const fs = require('fs');

// Mock window and escapeHTML
global.window = {
    escapeHTML: (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};
global.getEventName = () => "Annual Grand Meelad Fest 2026";
global.getCategoryThemeClass = (id) => 'cat-theme-general';

// Load exports.js source and extract renderCertificateSheetHTML
const exportsSrc = fs.readFileSync('js/exports.js', 'utf8');

// Evaluate the function in current context
const renderFuncMatch = exportsSrc.match(/function renderCertificateSheetHTML[\s\S]*?\n\}/);
if (!renderFuncMatch) {
    console.error("Could not extract renderCertificateSheetHTML");
    process.exit(1);
}

eval(renderFuncMatch[0]);

const sampleCert1 = {
    certId: "MLS-2026-0001",
    studentName: "Muhammad Bilal",
    chestNumber: "CH-102",
    className: "Class 10",
    teamName: "Team Al-Fath",
    programName: "Elocution (English)",
    programType: "Individual",
    position: "First",
    positionTitle: "FIRST POSITION",
    positionClass: "pos-first",
    dateStr: "JANUARY 2ND 2025",
    eventName: "Annual Grand Meelad Fest 2026",
    madrasaName: "COMPANY NAME",
    institutionSub: "DEPARTMENT OF ISLAMIC EDUCATION & CULTURAL AFFAIRS",
    logoUrl: "data:image/png;base64,samplelogo",
    signName: "Usthad Ahmad Moulavi",
    signTitle: "SIGNATURE",
    signImg: "data:image/png;base64,samplesign"
};

const sampleCertLongName = {
    certId: "MLS-2026-0002",
    studentName: "MUHAMMAD AMEEN ABDURAHMAN AL-BUKHARI THANGAL",
    chestNumber: "CH-105",
    className: "Class 10",
    teamName: "Team Al-Badr",
    programName: "Qawwali Group Song Competition",
    programType: "Group",
    position: "Second",
    positionTitle: "SECOND POSITION",
    positionClass: "pos-second",
    dateStr: "JANUARY 2ND 2025",
    eventName: "Annual Grand Meelad Fest 2026",
    madrasaName: "DARUL HUDA ISLAMIC UNIVERSITY ACADEMIC COUNCIL",
    institutionSub: "DEPARTMENT OF ISLAMIC EDUCATION & CULTURAL AFFAIRS",
    logoUrl: "",
    signName: "Usthad Ahmad Moulavi",
    signTitle: "PRINCIPAL / GENERAL SECRETARY",
    signImg: ""
};

const html1 = renderCertificateSheetHTML(sampleCert1, false);
console.log("Certificate 1 rendered length:", html1.length);
console.log("Contains rosette badge container:", html1.includes('cert-badge-container'));
console.log("Contains rosette svg:", html1.includes('cert-rosette-svg'));
console.log("Contains BEST AWARD text in badge:", html1.includes('BEST') && html1.includes('AWARD'));
console.log("Contains student name:", html1.includes('Muhammad Bilal'));
console.log("Contains Certificate main word:", html1.includes('cert-main-word'));
console.log("Contains OF ACHIEVEMENT:", html1.includes('OF ACHIEVEMENT'));
console.log("Contains date block:", html1.includes('cert-date-col') && html1.includes('DATE'));
console.log("Contains signature block:", html1.includes('cert-sign-col') && html1.includes('SIGNATURE'));

const htmlLong = renderCertificateSheetHTML(sampleCertLongName, false);
console.log("Long name certificate rendered length:", htmlLong.length);
console.log("Contains font-size scaling for long name:", htmlLong.includes('font-size:6.8mm') || htmlLong.includes('font-size:8.2mm'));
console.log("Contains pos-second class:", htmlLong.includes('pos-second'));
console.log("Contains 2ND in badge for 2nd position:", htmlLong.includes('2ND'));
