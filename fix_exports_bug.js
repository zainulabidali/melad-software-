const fs = require('fs');
let content = fs.readFileSync('js/exports.js', 'utf8');

// 1. Fix sorting by marks in Program Results Podium (Line ~7361)
content = content.replace(
    /const mA = Number\(a\.marks\) \|\| 0;\s*const mB = Number\(b\.marks\) \|\| 0;/g,
    `const mA = a.totalPoints !== undefined ? Number(a.totalPoints) : (Number(a.marks) || 0);
                            const mB = b.totalPoints !== undefined ? Number(b.totalPoints) : (Number(b.marks) || 0);`
);

// 2. Fix points display in Program Results Podium (Line ~7405)
content = content.replace(
    /let points = w\.marks !== undefined \? `\$\{w\.marks\} pts` : '0 pts';/g,
    `let wTotal = w.totalPoints !== undefined ? w.totalPoints : w.marks;
                                    let points = wTotal !== undefined ? \`\${wTotal} pts\` : '0 pts';`
);

// 3. Fix matching logic for Program Results Podium (Line ~7411)
content = content.replace(
    /match = r\.marksData\.find\(m =>[\s\S]*?\);/g,
    (match) => {
        if(match.includes("m.studentId === w.studentId") && match.includes("match = r.marksData.find(m =>")) {
            return `match = r.marksData.find(m => {
                                            const mId = m.studentId || m.groupId || m.id || '';
                                            const wId = w.studentId || w.groupId || w.id || '';
                                            const mName = m.studentName || m.groupName || m.name || '';
                                            const wName = w.studentName || w.groupName || w.name || '';
                                            const mTeam = m.teamName || '';
                                            const wTeam = w.teamName || '';

                                            if (r.programType === 'group' || r.type === 'Group') {
                                                return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            } else {
                                                return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            }
                                        });`;
        }
        return match;
    }
);

// 4. Fix matching in isWinner for Grade only fallback (Line ~7321)
content = content.replace(
    /const isWinner = winnersList\.some\(w =>[\s\S]*?\);/g,
    (match) => {
        if(match.includes("m.studentId === w.studentId") && match.includes("const isWinner = winnersList.some(w =>")) {
            return `const isWinner = winnersList.some(w => {
                                    const mId = m.studentId || m.groupId || m.id || '';
                                    const wId = w.studentId || w.groupId || w.id || '';
                                    const mName = m.studentName || m.groupName || m.name || '';
                                    const wName = w.studentName || w.groupName || w.name || '';
                                    const mTeam = m.teamName || '';
                                    const wTeam = w.teamName || '';

                                    if (r.programType === 'group' || r.type === 'Group') {
                                        return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    } else {
                                        return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    }
                                });`;
        }
        return match;
    }
);


// 5. Fix points display in Position Wise Winners Report (Line ~9061)
content = content.replace(
    /let points = w\.marks !== undefined \? w\.marks : 0;/g,
    `let wTotal = w.totalPoints !== undefined ? w.totalPoints : w.marks;
                    let points = wTotal !== undefined ? wTotal : 0;`
);

// 6. Fix `const pts = Number(w.marks) || 0;`
content = content.replace(
    /const pts = Number\(w\.marks\) \|\| 0;/g,
    `const pts = w.totalPoints !== undefined ? Number(w.totalPoints) : (Number(w.marks) || 0);`
);

fs.writeFileSync('js/exports.js', content);
console.log("Replaced bug patterns safely.");
