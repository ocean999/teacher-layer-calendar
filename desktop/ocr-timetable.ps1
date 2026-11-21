param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await-WinRT($winRtTask, $resultType) {
  $netTask = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($winRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
$storageFile = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRT ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

# 低分辨率课表截图自动 2 倍缩放以大幅提高 Windows 中文 OCR 识别率
$scale = if ($decoder.PixelWidth -lt 1800) { 2 } else { 1 }
$transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
$transform.ScaledWidth = [uint32]($decoder.PixelWidth * $scale)
$transform.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
$transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant

$bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync(
  $decoder.BitmapPixelFormat,
  $decoder.BitmapAlphaMode,
  $transform,
  [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
  [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage
)) ([Windows.Graphics.Imaging.SoftwareBitmap])

$lang = [Windows.Globalization.Language]::new('zh-Hans-CN')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if ($null -eq $engine) {
  throw "当前系统未启用 Windows OCR 语言包"
}

$ocrResult = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$items = @()
foreach ($line in $ocrResult.Lines) {
  $words = $line.Words
  if ($words.Count -eq 0) { continue }
  $minX = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
  $minY = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
  $maxX = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
  $maxY = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum

  $items += [PSCustomObject]@{
    text = $line.Text
    x    = [Math]::Round($minX, 1)
    y    = [Math]::Round($minY, 1)
    w    = [Math]::Round($maxX - $minX, 1)
    h    = [Math]::Round($maxY - $minY, 1)
  }
}

$output = [PSCustomObject]@{
  width  = $bitmap.PixelWidth
  height = $bitmap.PixelHeight
  lines  = $items
}
$output | ConvertTo-Json -Depth 4 -Compress
