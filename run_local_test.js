const fs = require('fs');

const firebaseCode = fs.readFileSync('js/firebase.js', 'utf8');

const extractFunction = (name) => {
    const startIdx = firebaseCode.indexOf(`function ${name}`);
    if (startIdx === -1) return '';
    let braceCount = 0;
    let endIdx = -1;
    let started = false;
    for (let i = startIdx; i < firebaseCode.length; i++) {
        if (firebaseCode[i] === '{') {
            braceCount++;
            started = true;
        } else if (firebaseCode[i] === '}') {
            braceCount--;
        }
        if (started && braceCount === 0) {
            endIdx = i;
            break;
        }
    }
    return firebaseCode.substring(startIdx, endIdx + 1);
};

const normalizePointsConfig = extractFunction('normalizePointsConfig');
const computeDenseRanking = extractFunction('computeDenseRanking');
const getGradeAndPoints = extractFunction('getGradeAndPoints');
const resolveEffectiveGrade = extractFunction('resolveEffectiveGrade');
const getGradePointsForGrade = extractFunction('getGradePointsForGrade');
const calculateResultData = extractFunction('calculateResultData');

const DEFAULT_POINTS = {
    individual: { first: 10, second: 8, third: 6, participation: 0, 
        grades: { 'A': 5, 'B': 3, 'C': 1, 'none': 0 },
        gradeRanges: { 'A': { min: 80, max: 100 }, 'B': { min: 60, max: 79.99 }, 'C': { min: 40, max: 59.99 } }
    }
};

let combined = `
${normalizePointsConfig}
${computeDenseRanking}
${getGradeAndPoints}
${resolveEffectiveGrade}
${getGradePointsForGrade}
${calculateResultData}

const testMarksData = [
    { studentName: 'MUHAMMED FAYIZ', marks: [60, 60] },
    { studentName: 'ZAHID ABBAS', marks: [65, 70] },
    { studentName: 'ABDULLA', marks: [65, 75] },
    { studentName: 'JAZEEL', marks: [30, 25] }
];

const dbJudges = ['Judge 1', 'Judge 2'];
const judgeIds = ['j1', 'j2'];
const judgeSubmissionStatus = { 'j1': 'submitted', 'j2': 'submitted' };
const activePointsConfig = ${JSON.stringify(DEFAULT_POINTS)};

const result = calculateResultData({
    marksData: testMarksData,
    dbJudges: dbJudges,
    judgeIds: judgeIds,
    judgeSubmissionStatus: judgeSubmissionStatus,
    gradeMode: 'auto',
    pointsConfig: activePointsConfig,
    classType: 'individual',
    isGroup: false
});

result.marksData.forEach(m => {
    console.log(\`\${m.studentName.padEnd(15)} | Final: \${m.finalMark} | Rank: \${m.rank}\`);
});
`;

combined = combined.replace(/export function/g, 'function');
fs.writeFileSync('test_run.js', combined);
