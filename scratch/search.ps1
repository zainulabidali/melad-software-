$content = Get-Content -Raw -Path "..\js\exports.js"
$lines = $content -split "`r?`n"
$keywords = @("grade")
foreach ($kw in $keywords) {
    Write-Output "=== Matches for: $kw ==="
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i].ToLower().Contains($kw)) {
            Write-Output ("$($i + 1): " + $lines[$i].Trim())
        }
    }
}
