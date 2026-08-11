import re

with open('js/results.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("window.teamMap = new Map(cachedTeams.map(t => [t.id, t.name]));", "window.teamMap = new Map(cachedTeams.map(t => [String(t.id), t.name]));")

old_str = "const resolvedTeam = (item.teamId && window.teamMap && window.teamMap.has(item.teamId))\n                ? window.teamMap.get(item.teamId)"
new_str = "const resolvedTeam = (item.teamId && window.teamMap)\n                ? (window.teamMap.get(String(item.teamId)) || item.teamName || '—')"

content = content.replace(old_str, new_str)
content = content.replace("const resolvedName = window.teamMap ? (window.teamMap.get(id) || id) : id;", "const resolvedName = window.teamMap ? (window.teamMap.get(String(id)) || id) : id;")

with open('js/results.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
