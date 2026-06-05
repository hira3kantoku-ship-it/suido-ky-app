$port = 3838
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving on http://localhost:$port"
$mt = @{'.html'='text/html; charset=utf-8';'.css'='text/css';'.js'='application/javascript';'.json'='application/json';'.png'='image/png';'.ttf'='font/ttf'}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  $p = $req.Url.LocalPath; if ($p -eq '/') { $p = '/index.html' }
  $fp = Join-Path $root $p.TrimStart('/')
  if (Test-Path $fp -PathType Leaf) {
    $e = [System.IO.Path]::GetExtension($fp)
    $m = if ($mt[$e]) { $mt[$e] } else { 'application/octet-stream' }
    $b = [System.IO.File]::ReadAllBytes($fp)
    $res.ContentType = $m; $res.ContentLength64 = $b.Length
    $res.OutputStream.Write($b, 0, $b.Length)
  } else { $res.StatusCode = 404 }
  $res.Close()
}
