import re

with open('js/exports.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the helper function at the top of exports.js
helper = """
function getSafeTeamName(item, studentMap, teamNamesMap) {
    if (!item) return '—';
    let tId = item.teamId;
    
    // Fallback to studentMap if participant document lacks teamId
    if (!tId) {
        if (item.isGroup && item.members && item.members.length > 0) {
            const stu = item.members[0].studentId ? studentMap[item.members[0].studentId] : null;
            if (stu) tId = stu.teamId;
        } else if (!item.isGroup && item.studentId) {
            const stu = studentMap[item.studentId];
            if (stu) tId = stu.teamId;
        }
    }
    
    if (tId && teamNamesMap && teamNamesMap[String(tId)]) {
        return teamNamesMap[String(tId)];
    }
    
    return item.teamName || '—';
}
"""

if "function getSafeTeamName" not in content:
    content = content.replace("export async function initExportsView", helper + "\nexport async function initExportsView")

# 1. Fix Call List PDF general (no groups)
old_1 = """                    parts.forEach(item => {
                        let tName = 'General';
                        if (item.teamId) {
                            const matchedName = teamNamesMap[String(item.teamId)];
                            tName = matchedName || item.teamName || 'General';
                        } else if (item.teamName) {
                            tName = item.teamName;
                        }"""
new_1 = """                    parts.forEach(item => {
                        let tName = getSafeTeamName(item, studentMap, teamNamesMap);
                        if (tName === '—') tName = 'General';"""
content = content.replace(old_1, new_1)

# 2. Fix Call List PDF group
old_2 = """<span class="call-team-badge">${window.escapeHTML((groupItem.teamId ? teamNamesMap[String(groupItem.teamId)] : null) || groupItem.teamName || '—')}</span>"""
new_2 = """<span class="call-team-badge">${window.escapeHTML(getSafeTeamName(groupItem, studentMap, teamNamesMap))}</span>"""
content = content.replace(old_2, new_2)

# 3. Fix Call List PDF standard
old_3 = """<span class="call-team-badge">${window.escapeHTML((item.teamId ? teamNamesMap[String(item.teamId)] : null) || item.teamName || '—')}</span>"""
new_3 = """<span class="call-team-badge">${window.escapeHTML(getSafeTeamName(item, studentMap, teamNamesMap))}</span>"""
content = content.replace(old_3, new_3)


# 4. Fix Call List CSV
old_4 = """csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${className}","${item.teamName || ''}"\\n`;"""
new_4 = """csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${className}","${getSafeTeamName(item, studentMap, teamNamesMap)}"\\n`;"""
content = content.replace(old_4, new_4)

# 5. Fix Chest Number PDF Team Badge
old_5 = """<span class="chest-team-badge">${window.escapeHTML(item.teamName)}</span>"""
new_5 = """<span class="chest-team-badge">${window.escapeHTML(getSafeTeamName(item, studentMap, teamNamesMap))}</span>"""
content = content.replace(old_5, new_5)

# 6. Fix Chest Number CSV
old_6 = """const teamClean = item.teamName.replace(/"/g, '""');"""
new_6 = """const teamClean = getSafeTeamName(item, studentMap, teamNamesMap).replace(/"/g, '""');"""
content = content.replace(old_6, new_6)

# 7. Fix Valuation Sheet CSV
old_7 = """const teamClean = item.teamName.replace(/"/g, '""');"""
new_7 = """const teamClean = getSafeTeamName(item, studentMap, teamNamesMap).replace(/"/g, '""');"""
content = content.replace(old_7, new_7)

# 8. Fix Green Room Sign CSV
old_8 = """const teamClean = item.teamName.replace(/"/g, '""');"""
new_8 = """const teamClean = getSafeTeamName(item, studentMap, teamNamesMap).replace(/"/g, '""');"""
content = content.replace(old_8, new_8)

# 9. Fix Program Participation Register CSV
old_9 = """csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${className}","${item.teamName || ''}"\\n`;"""
new_9 = """csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${className}","${getSafeTeamName(item, studentMap, teamNamesMap)}"\\n`;"""
content = content.replace(old_9, new_9)

with open('js/exports.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
