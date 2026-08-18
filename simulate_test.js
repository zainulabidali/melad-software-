
function normalizePointsConfig(data) {
    if (!data || typeof data !== 'object') {
        return JSON.parse(JSON.stringify(DEFAULT_POINTS));
    }
    const config = { ...data };
    if (!config.individual) config.individual = { ...DEFAULT_POINTS.individual };
    if (!config.group) config.group = { ...DEFAULT_POINTS.group };
    if (!config.general) config.general = { ...DEFAULT_POINTS.general };

    if (!Array.isArray(config.grades) || config.grades.length === 0) {
        config.grades = JSON.parse(JSON.stringify(DEFAULT_GRADES));
    } else {
        // Clean and sanitize grade items
        config.grades = config.grades.map(g => ({
            name: String(g.name || '').trim(),
            minMark: Number(g.minMark),
            maxMark: Number(g.maxMark),
            gradePoint: Number(g.gradePoint || 0)
        })).filter(g => g.name !== '' && !isNaN(g.minMark) && !isNaN(g.maxMark));
    }

    // Keep grades sorted by minMark descending
    config.grades.sort((a, b) => b.minMark - a.minMark);
    return config;
}
function computeDenseRanking(items, getScoreFn, rankPropName = 'rank') {
    if (!Array.isArray(items) || items.length === 0) return items;

    // Pre-calculate scores once O(N) to avoid calling getScoreFn repeatedly during N log N sort comparisons
    const scored = items.map(item => ({
        item,
        score: Number(getScoreFn(item) || 0)
    }));

    scored.sort((a, b) => b.score - a.score);

    let currentRank = 0;
    let prevScore = null;

    for (let i = 0; i < scored.length; i++) {
        const entry = scored[i];
        if (entry.score !== prevScore) {
            currentRank++;
            prevScore = entry.score;
        }
        entry.item[rankPropName] = currentRank;
    }
    return items;
}
function getGradeAndPoints(score, pointsConfig = null, classType = 'individual') {
    if (score === null || score === undefined || score === '' || isNaN(Number(score))) {
        return { grade: '', points: 0 };
    }

    const numScore = Number(score);
    const config = normalizePointsConfig(pointsConfig);
    const gradesList = config.grades;

    const matched = gradesList.find(g => numScore >= g.minMark && numScore <= g.maxMark);
    if (matched) {
        return {
            grade: matched.name,
            points: Number(matched.gradePoint) || 0
        };
    }

    return { grade: '', points: 0 };
}
function resolveEffectiveGrade({
    automaticGrade,
    adminManualGrade,
    legacyManualGrade,
    manualGrades,
    judgeSubmissionStatus,
    judgeIds,
    pointsConfig = null
}
function getGradePointsForGrade(gradeName, pointsConfig = null, classType = 'individual') {
    if (!gradeName || typeof gradeName !== 'string') return 0;
    const config = normalizePointsConfig(pointsConfig);
    const cleanGrade = gradeName.trim().toLowerCase();

    const matched = config.grades.find(g => g.name.toLowerCase() === cleanGrade);
    if (matched) {
        return Number(matched.gradePoint) || 0;
    }

    // Fallback for legacy database properties if any
    if (pointsConfig && pointsConfig[classType]) {
        const legacyMap = { 'a+': 'gradeAPlus', 'a': 'gradeA', 'b+': 'gradeBPlus', 'b': 'gradeB', 'c': 'gradeC' };
        const key = legacyMap[cleanGrade];
        if (key && pointsConfig[classType][key] !== undefined) {
            return Number(pointsConfig[classType][key]) || 0;
        }
    }

    return 0;
}
function calculateResultData({
    marksData,
    dbJudges,
    judgeIds,
    judgeSubmissionStatus,
    gradeMode = 'auto',
    pointsConfig,
    classType,
    isGroup = false
}

const testMarksData = [
    { studentName: 'MUHAMMED FAYIZ', marks: [60, 60] },
    { studentName: 'ZAHID ABBAS', marks: [65, 70] },
    { studentName: 'ABDULLA', marks: [65, 75] },
    { studentName: 'JAZEEL', marks: [30, 25] }
];

const dbJudges = ['Judge 1', 'Judge 2'];
const judgeIds = ['j1', 'j2'];
const judgeSubmissionStatus = { 'j1': 'submitted', 'j2': 'submitted' };
const activePointsConfig = {"individual":{"first":10,"second":8,"third":6,"participation":0,"grades":{"A":5,"B":3,"C":1,"none":0},"gradeRanges":{"A":{"min":80,"max":100},"B":{"min":60,"max":79.99},"C":{"min":40,"max":59.99}}}};

console.log("=== RUNNING TWO-JUDGE TEST CASE ===");

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
    console.log(`${m.studentName.padEnd(15)} | Final: ${m.finalMark.toString().padEnd(5)} | Rank: ${(m.rank+'').padEnd(3)} | Position: ${m.position.padEnd(6)} | Grade: ${m.grade.padEnd(2)} | Pts: ${m.totalPoints}`);
});

console.log("===================================");
