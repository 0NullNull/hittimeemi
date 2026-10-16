# Tiny static file server for Hittimeemi (YouTube embeds need http://, not file://).
# Supports Range requests so seeking in local audio files works.
param([int]$Port = 8000, [switch]$NoBrowser)

$root = [IO.Path]::GetFullPath($PSScriptRoot)
$types = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json"; ".svg" = "image/svg+xml"
  ".png" = "image/png"; ".jpg" = "image/jpeg"; ".ico" = "image/x-icon"
  ".mp3" = "audio/mpeg"; ".ogg" = "audio/ogg"; ".m4a" = "audio/mp4"; ".wav" = "audio/wav"; ".webm" = "audio/webm"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Hittimeemi: http://localhost:$Port/"
Write-Host "Close this window to stop the server."
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))

    if (-not $file.StartsWith($root) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $len = $bytes.Length
      $start = 0; $end = $len - 1
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = "application/octet-stream" }
      $res.AddHeader("Accept-Ranges", "bytes")
      $res.AddHeader("Cache-Control", "no-cache")

      $range = $ctx.Request.Headers["Range"]
      if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
        if ($matches[1]) {
          $start = [long]$matches[1]
          if ($matches[2]) { $end = [Math]::Min([long]$matches[2], $len - 1) }
        } elseif ($matches[2]) {
          $start = [Math]::Max(0, $len - [long]$matches[2])
        }
        $res.StatusCode = 206
        $res.AddHeader("Content-Range", "bytes $start-$end/$len")
      }
      $count = $end - $start + 1
      $res.ContentLength64 = $count
      $res.OutputStream.Write($bytes, $start, $count)
    }
  } catch {
    # Browser cancelled the request (common with audio); ignore.
  } finally {
    try { $res.Close() } catch {}
  }
}
