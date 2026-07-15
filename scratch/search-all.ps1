$files = Get-ChildItem -Path ".." -Filter "*.js" -Recurse -File
foreach ($file in $files) {
    $content = Get-Content -Raw -Path $file.FullName
    $lines = $content -split "`r?`n"
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i].ToLower().Contains("grade")) {
            Write-Output ("$($file.Name):$($i + 1): " + $lines[$i].Trim())
        }
    }
}
