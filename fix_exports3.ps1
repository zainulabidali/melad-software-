$content = [System.IO.File]::ReadAllText("js/exports.js", [System.Text.Encoding]::UTF8)
$oldStr = @"
                    // Group actual participants by team for General Programs with individual registrations (1 row per team)
                    const teamsMap = {};
                    parts.forEach(item => {
                        let tName = 'General';
                        if (item.teamId) {
                            const matchedName = teamNamesMap[String(item.teamId)];
                            tName = matchedName || item.teamName || 'General';
                        } else if (item.teamName) {
                            tName = item.teamName;
                        }
"@
$newStr = @"
                    // Group actual participants by team for General Programs with individual registrations (1 row per team)
                    const teamsMap = {};
                    parts.forEach(item => {
                        let tName = getSafeTeamName(item, studentMap, teamNamesMap);
                        if (tName === '—') tName = 'General';
"@
$content = $content.Replace($oldStr, $newStr)
[System.IO.File]::WriteAllText("js/exports.js", $content, [System.Text.Encoding]::UTF8)
Write-Output "Done"
