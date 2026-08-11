import re

with open('js/mark-entry.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add getCachedTeams
content = content.replace("getCachedStudentsMap,", "getCachedStudentsMap, getCachedTeams,")

# 2. Add teamsMapCache and ensureTeamsMap
old_decl = "let allPrograms = [];"
new_decl = """let allPrograms = [];
let teamsMapCache = new Map();
async function ensureTeamsMap() {
    if (teamsMapCache.size === 0 && window.currentInstituteId) {
        try {
            const teams = await getCachedTeams(window.currentInstituteId);
            teamsMapCache = new Map(teams.map(t => [String(t.id), t]));
        } catch (e) {
            console.error("Failed to load teams:", e);
        }
    }
}"""
content = content.replace(old_decl, new_decl)

# 3. Add await ensureTeamsMap() in openMarkEntryModal
old_open = """export async function openMarkEntryModal(prog) {
    if (!window.currentInstituteId) {"""
new_open = """export async function openMarkEntryModal(prog) {
    if (!window.currentInstituteId) {"""
content = content.replace(old_open, new_open) # wait, I will just put it where points config is fetched

old_points = "activePointsConfig = await getCachedPointsConfig(window.currentInstituteId, true);"
new_points = "await ensureTeamsMap();\n        activePointsConfig = await getCachedPointsConfig(window.currentInstituteId, true);"
content = content.replace(old_points, new_points)

# 4. Add await ensureTeamsMap() in loadMarkEntryData
old_load = """async function loadMarkEntryData() {
    try {"""
new_load = """async function loadMarkEntryData() {
    try {
        await ensureTeamsMap();"""
content = content.replace(old_load, new_load)

# 5. Replace p.teamName usages
content = content.replace("p.teamName || ''", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName || '')")
content = content.replace("p.teamName || '-'", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName || '-')")
content = content.replace("p.teamName)", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName))")
content = content.replace("p.teamName}", "(teamsMapCache.get(String(p.teamId))?.name || p.teamName)}")

with open('js/mark-entry.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
