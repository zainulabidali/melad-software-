 = Get-Content -Raw js\mark-entry.js

# Add getCachedTeams to import
 =  -replace "getCachedStudentsMap,", "getCachedStudentsMap, getCachedTeams,"

# Add teamsMapCache and ensureTeamsMap after let allPrograms
 =  -replace "let allPrograms = \[\];", "let allPrograms = [];
let teamsMapCache = new Map();
async function ensureTeamsMap() {
    if (teamsMapCache.size === 0 && window.currentInstituteId) {
        const teams = await getCachedTeams(window.currentInstituteId);
        teamsMapCache = new Map(teams.map(t => [String(t.id), t]));
    }
}"

# Add await ensureTeamsMap() inside openMarkEntryModal
 =  -replace "export async function openMarkEntryModal\(prog\) \{
    if \(\!window.currentInstituteId\) \{", "export async function openMarkEntryModal(prog) {
    if (!window.currentInstituteId) {"
 =  -replace "activePointsConfig = await getCachedPointsConfig", "await ensureTeamsMap();
        activePointsConfig = await getCachedPointsConfig"

# Add await ensureTeamsMap() inside loadMarkEntryData
 =  -replace "async function loadMarkEntryData\(\) \{
    try \{", "async function loadMarkEntryData() {
    try {
        await ensureTeamsMap();"

# Replace usages of p.teamName
 =  -replace "p\.teamName \|\| ''", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName || '')"
 =  -replace "p\.teamName \|\| '-'", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName || '-')"
 =  -replace "p\.teamName\)", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName))"

Set-Content -Path js\mark-entry.js -Value 
