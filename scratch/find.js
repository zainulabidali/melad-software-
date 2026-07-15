const fs = require('fs');
const content = fs.readFileSync('../js/exports.js', 'utf8');
const lines = content.split('\n');

const keywords = [
    'team wise', 'program wise', 'student prize', 'prize distribution', 
    'students without', 'championship standings', 'podium', 'winner', 
    'participantsmap', 'loadparticipants', 'groupname'
];

keywords.forEach(kw => {
    console.log(`=== Matches for: "${kw}" ===`);
    lines.forEach((line, index) => {
        if (line.toLowerCase().includes(kw)) {
            console.log(`${index + 1}: ${line.trim()}`);
        }
    });
});
