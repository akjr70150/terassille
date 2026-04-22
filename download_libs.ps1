# Run this script from your terassille folder in PowerShell
# It downloads the map libraries locally so Android WebView can load them

New-Item -ItemType Directory -Force -Path "www\lib" | Out-Null

Write-Host "Downloading MapLibre GL JS..."
Invoke-WebRequest -Uri "https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.js" -OutFile "www\lib\maplibre-gl.js"

Write-Host "Downloading MapLibre GL CSS..."
Invoke-WebRequest -Uri "https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.css" -OutFile "www\lib\maplibre-gl.css"

Write-Host "Downloading SunCalc..."
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js" -OutFile "www\lib\suncalc.min.js"

Write-Host ""
Write-Host "Done! Library files saved to www\lib\"
Write-Host "File sizes:"
Get-ChildItem "www\lib\" | Select-Object Name, @{Name="Size(KB)";Expression={[math]::Round($_.Length/1KB,1)}}
