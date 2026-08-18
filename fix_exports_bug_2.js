const fs = require('fs');
let content = fs.readFileSync('js/exports.js', 'utf8');

// The code block to replace starts with:
// match = r.marksData.find(m => {
//     const mId = m.studentId || m.groupId || m.id || '';

const searchBlock = `match = r.marksData.find(m => {
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

const replaceBlock = `const posToRank = { 'First': 1, 'Second': 2, 'Third': 3 };
                                        const rankToMatch = posToRank[w.position];
                                        
                                        // 1. Bulletproof match by Rank/Position (guarantees correct points even if names mismatch)
                                        match = r.marksData.find(m => m.position === w.position || (rankToMatch && m.rank === rankToMatch));
                                        
                                        // 2. Fallback to name/id identity
                                        if (!match) {
                                            match = r.marksData.find(m => {
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
                                            });
                                        }`;

content = content.replace(searchBlock, replaceBlock);

fs.writeFileSync('js/exports.js', content);
console.log("Applied position-based matching to exports.js");
