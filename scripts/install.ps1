$ErrorActionPreference = "Stop"

$repo = "Restuta/pubmd"
$binaryName = "pubmd.exe"
$installDir = "$env:LOCALAPPDATA\pubmd"

Write-Host "Fetching latest release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
$tag = $release.tag_name
$url = "https://github.com/$repo/releases/download/$tag/pubmd-windows-x64.exe"

Write-Host "Installing pubmd $tag..."
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir $binaryName
Invoke-WebRequest -Uri $url -OutFile $target

# Add to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host ""
    Write-Host "Added $installDir to your PATH."
    Write-Host "Restart your terminal for the change to take effect."
}

Write-Host ""
Write-Host "Installed pubmd to $target"
& $target --help
