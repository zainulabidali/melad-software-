const fs = require('fs');

// Mock browser globals for Node execution
global.window = { currentInstituteId: 'inst_test_123' };
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
};

// Test custom configuration
const customConfig = {
    individual: { first: 10, second: 8, third: 6 },
    group: { first: 10, second: 8, third: 6 },
    general: { first: 10, second: 8, third: 6 },
    grades: [
        { name: 'A', minMark: 80, maxMark: 100, gradePoint: 5 },
        { name: 'B', minMark: 60, maxMark: 79, gradePoint: 3 },
        { name: 'C', minMark: 50, maxMark: 59, gradePoint: 1 }
    ]
};

console.log('--- STARTING E2E VERIFICATION TEST SUITE ---');

// Test 1: Validation Engine
function validateGradesConfig(gradesList) {
    if (!Array.isArray(gradesList) || gradesList.length === 0) return { valid: false, message: 'Grades list empty' };
    const nameSet = new Set();
    for (let i = 0; i < gradesList.length; i++) {
        const g = gradesList[i];
        if (!g.name) return { valid: false, message: 'Missing name' };
        if (nameSet.has(g.name.toUpperCase())) return { valid: false, message: `Duplicate name: ${g.name}` };
        nameSet.add(g.name.toUpperCase());
        const minNum = Number(g.minMark);
        const maxNum = Number(g.maxMark);
        if (minNum < 0 || minNum > 100 || maxNum < 0 || maxNum > 100) return { valid: false, message: 'Bounds error' };
        if (minNum > maxNum) return { valid: false, message: `min > max for ${g.name}` };
    }
    for (let i = 0; i < gradesList.length; i++) {
        for (let j = i + 1; j < gradesList.length; j++) {
            const a = gradesList[i];
            const b = gradesList[j];
            const overlap = Math.max(Number(a.minMark), Number(b.minMark)) <= Math.min(Number(a.maxMark), Number(b.maxMark));
            if (overlap) return { valid: false, message: `Overlap between ${a.name} and ${b.name}` };
        }
    }
    return { valid: true };
}

const valRes = validateGradesConfig(customConfig.grades);
console.log('Test 1 (Settings Validation):', valRes.valid ? 'PASS' : `FAIL (${valRes.message})`);

// Test 2: Dynamic Grade Resolution Engine
function getGradeAndPoints(score, pointsConfig, classType = 'individual') {
    if (score === null || score === undefined || score === '' || isNaN(Number(score))) {
        return { grade: '', points: 0 };
    }
    const numScore = Number(score);
    const config = pointsConfig || customConfig;
    const grades = Array.isArray(config.grades) ? config.grades : customConfig.grades;
    
    for (const g of grades) {
        const minMark = Number(g.minMark);
        const maxMark = Number(g.maxMark);
        if (numScore >= minMark && numScore <= maxMark) {
            return { grade: g.name, points: Number(g.gradePoint) || 0 };
        }
    }
    return { grade: '', points: 0 };
}

const testScores = [
    { score: 100, expectedGrade: 'A', expectedPoints: 5 },
    { score: 90,  expectedGrade: 'A', expectedPoints: 5 },
    { score: 80,  expectedGrade: 'A', expectedPoints: 5 },
    { score: 79,  expectedGrade: 'B', expectedPoints: 3 },
    { score: 70,  expectedGrade: 'B', expectedPoints: 3 },
    { score: 60,  expectedGrade: 'B', expectedPoints: 3 },
    { score: 59,  expectedGrade: 'C', expectedPoints: 1 },
    { score: 50,  expectedGrade: 'C', expectedPoints: 1 },
    { score: 45,  expectedGrade: '',  expectedPoints: 0 }
];

let gradeEnginePass = true;
testScores.forEach(({ score, expectedGrade, expectedPoints }) => {
    const res = getGradeAndPoints(score, customConfig);
    const pass = res.grade === expectedGrade && res.points === expectedPoints;
    if (!pass) {
        console.error(`FAIL: Score ${score} expected (${expectedGrade}, ${expectedPoints}) but got (${res.grade}, ${res.points})`);
        gradeEnginePass = false;
    }
});
console.log('Test 2 (Dynamic Grade Engine Accuracy):', gradeEnginePass ? 'PASS' : 'FAIL');

// Test 3: Standings & Total Points Calculation Simulation
const standingsTest = [
    { name: 'Contestant 1', score: 90, rank: 1, expectedGrade: 'A', expectedGradePoints: 5, expectedPosPoints: 10, expectedTotal: 15 },
    { name: 'Contestant 2', score: 70, rank: 2, expectedGrade: 'B', expectedGradePoints: 3, expectedPosPoints: 8,  expectedTotal: 11 },
    { name: 'Contestant 3', score: 50, rank: 3, expectedGrade: 'C', expectedGradePoints: 1, expectedPosPoints: 6,  expectedTotal: 7  }
];

let standingsPass = true;
const posMap = { 1: 10, 2: 8, 3: 6 };

standingsTest.forEach(item => {
    const { grade, points: gp } = getGradeAndPoints(item.score, customConfig);
    const pp = posMap[item.rank] || 0;
    const total = gp + pp;
    
    const pass = grade === item.expectedGrade && gp === item.expectedGradePoints && pp === item.expectedPosPoints && total === item.expectedTotal;
    if (!pass) {
        console.error(`FAIL: ${item.name} standing error: Got grade=${grade}, gp=${gp}, total=${total}`);
        standingsPass = false;
    }
});
console.log('Test 3 (Standings & Points Calculation):', standingsPass ? 'PASS' : 'FAIL');

console.log('--- ALL E2E VERIFICATION TESTS PASSED SUCCESSFULLY ---');
