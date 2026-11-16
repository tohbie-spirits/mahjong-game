# serve.ps1 - a tiny local web server for the Mahjong game (Windows, no installs needed).
# Put this file in the mahjong-game folder (next to index.html) and run start-game.bat,
# or in PowerShell:  powershell -ExecutionPolicy Bypass -File .\serve.ps1
$root = $PSScriptRoot
$port = 8000
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $port (is it already running?)"; Read-Host 'Press Enter to close'; exit 1 }
Write-Host "Mahjong is running at http://localhost:$port/"
Write-Host 'Close this window to stop it.'
Start-Process "http://localhost:$port/"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] } else { $ctx.Response.ContentType = 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      $ctx.Response.StatusCode = 500
    } finally {
      $ctx.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}
