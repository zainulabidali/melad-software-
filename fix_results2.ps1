$content = [System.IO.File]::ReadAllText("js/results.js", [System.Text.Encoding]::UTF8)

$content = $content.Replace("window.teamMap = new Map(cachedTeams.map(t => [t.id, t.name]));", "window.teamMap = new Map(cachedTeams.map(t => [String(t.id), t.name]));")

$oldStr1 = "const resolvedName = window.teamMap ? (window.teamMap.get(id) || id) : id;"
$newStr1 = "const resolvedName = window.teamMap ? (window.teamMap.get(String(id)) || id) : id;"
$content = $content.Replace($oldStr1, $newStr1)

$oldStr2 = "const resolvedTeam = (item.teamId && window.teamMap && window.teamMap.has(item.teamId))`n                ? window.teamMap.get(item.teamId)"
$newStr2 = "const resolvedTeam = (item.teamId && window.teamMap)`n                ? (window.teamMap.get(String(item.teamId)) || item.teamName || '—')"
$content = $content.Replace($oldStr2, $newStr2)

$oldStr3 = "const resolvedTeam = (item.teamId && window.teamMap && window.teamMap.has(item.teamId))`r`n                ? window.teamMap.get(item.teamId)"
$newStr3 = "const resolvedTeam = (item.teamId && window.teamMap)`r`n                ? (window.teamMap.get(String(item.teamId)) || item.teamName || '—')"
$content = $content.Replace($oldStr3, $newStr3)

[System.IO.File]::WriteAllText("js/results.js", $content, [System.Text.Encoding]::UTF8)
Write-Output "Done"
