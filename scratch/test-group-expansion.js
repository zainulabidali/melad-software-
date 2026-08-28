const fs = require('fs');

const exportsSrc = fs.readFileSync('js/exports.js', 'utf8');

// We need to extract resolveWinnerParticipant
const resolveMatch = exportsSrc.match(/function resolveWinnerParticipant\([\s\S]*?\n\}/g);
if (resolveMatch) {
    eval(resolveMatch[0]);
} else {
    console.error("Could not find resolveWinnerParticipant");
    process.exit(1);
}

const mockStudentMap = {
    'stu1': { id: 'stu1', name: 'Ali', chestNumber: 'C-01', teamId: 't1', teamName: 'Team A' },
    'stu2': { id: 'stu2', name: 'Zaid', chestNumber: 'C-02', teamId: 't1', teamName: 'Team A' },
    'stu3': { id: 'stu3', name: 'Umar', chestNumber: 'C-03', teamId: 't2', teamName: 'Team B' }
};

const groupProg = { id: 'p1', programType: 'Group' };
const individualProg = { id: 'p2', programType: 'Individual' };

const groupWinner = { studentName: 'Team A', teamId: 't1' };
const individualWinner = { studentName: 'Umar', studentId: 'stu3' };

const participantsList = [
    {
        id: 'gp1',
        isGroup: true,
        name: 'Team A',
        teamId: 't1',
        teamName: 'Team A',
        members: [
            { studentId: 'stu1' },
            { studentId: 'stu2' }
        ]
    },
    {
        id: 'ip1',
        isGroup: false,
        name: 'Umar',
        studentId: 'stu3',
        teamId: 't2',
        teamName: 'Team B'
    }
];

const groupResolved = resolveWinnerParticipant(groupProg, groupWinner, participantsList, mockStudentMap);
console.log("Group Resolved:", JSON.stringify(groupResolved, null, 2));

const individualResolved = resolveWinnerParticipant(individualProg, individualWinner, participantsList, mockStudentMap);
console.log("Individual Resolved:", JSON.stringify(individualResolved, null, 2));

if (groupResolved.isGroup === true && individualResolved.isGroup === false) {
    console.log("SUCCESS: isGroup property correctly assigned.");
} else {
    console.error("FAILED: isGroup property missing or incorrect.");
    process.exit(1);
}
