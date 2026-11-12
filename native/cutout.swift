// cutroom-cutout: lift the subject out of a picture or a video with Apple's Vision framework.
// Runs on this Mac, no account. Cutroom compiles it on first launch (see src/main/tools.ts).
//
//   cutroom-cutout <in> <out.png> [--at s] [--subject any|person] [--outline 0.02] [--no-trim]
//   cutroom-cutout <in> <out.mov> [--from s] [--to s] [--subject auto|any|person]
//
// A .png is a still (a sticker); a .mov is ProRes 4444 with transparency, same size and frame rate as the source.
import AVFoundation
import Accelerate
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision

struct Failure: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

enum Subject: String { case auto, any, person }

let context = CIContext()
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

/// Finds the subject in a picture, or frame after frame of a video.
final class Matter {
  var subject: Subject
  // Reused across frames: the person model smooths over time when it sees a sequence.
  private let person = VNGeneratePersonSegmentationRequest()
  private let sequence = VNSequenceRequestHandler()

  init(_ subject: Subject) {
    self.subject = subject
    person.qualityLevel = .accurate
    person.outputPixelFormat = kCVPixelFormatType_OneComponent8
  }

  /// `auto` becomes `person` when there is someone in the picture, else `any`.
  func settle(on image: CIImage) throws {
    guard subject == .auto else { return }
    let people = VNDetectHumanRectanglesRequest()
    try VNImageRequestHandler(ciImage: image).perform([people])
    subject = (people.results ?? []).isEmpty ? .any : .person
  }

  /// White where the subject is, at the size of `image`. nil when nothing stands out.
  func matte(of image: CIImage) throws -> CIImage? {
    if subject == .person {
      try sequence.perform([person], on: image)
      guard let buffer = person.results?.first?.pixelBuffer else { return nil }
      let mask = CIImage(cvPixelBuffer: buffer)
      return mask.transformed(by: CGAffineTransform(scaleX: image.extent.width / mask.extent.width, y: image.extent.height / mask.extent.height))
    }
    let handler = VNImageRequestHandler(ciImage: image)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let found = request.results?.first, !found.allInstances.isEmpty else { return nil }
    return CIImage(cvPixelBuffer: try found.generateScaledMaskForImage(forInstances: found.allInstances, from: handler))
  }
}

let clear = CIImage(color: .clear)

func cut(_ image: CIImage, with mask: CIImage?) -> CIImage {
  guard let mask else { return clear.cropped(to: image.extent) }
  let blend = CIFilter.blendWithRedMask()
  blend.inputImage = image
  blend.backgroundImage = clear
  blend.maskImage = mask
  return blend.outputImage!.cropped(to: image.extent)
}

/// The rectangle that holds everything the mask shows.
func bounds(of mask: CIImage) -> CGRect? {
  let scale = min(1, 512 / max(mask.extent.width, mask.extent.height))
  let small = mask.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  let (w, h) = (Int(small.extent.width.rounded(.up)), Int(small.extent.height.rounded(.up)))
  var pixels = [UInt8](repeating: 0, count: w * h * 4)
  context.render(small, toBitmap: &pixels, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: nil)
  var (x0, y0, x1, y1) = (w, h, -1, -1)
  for y in 0..<h {
    for x in 0..<w where pixels[(y * w + x) * 4] > 40 {
      (x0, y0, x1, y1) = (min(x0, x), min(y0, y), max(x1, x), max(y1, y))
    }
  }
  guard x1 >= 0 else { return nil }
  // Bitmap rows run top to bottom, Core Image's y bottom to top.
  return CGRect(x: CGFloat(x0) / scale, y: CGFloat(h - 1 - y1) / scale, width: CGFloat(x1 - x0 + 1) / scale, height: CGFloat(y1 - y0 + 1) / scale)
}

func still(from input: URL, to output: URL, at time: Double?, subject: Subject, outline: Double, trim: Bool) async throws {
  var image: CIImage
  if let time {
    let frames = AVAssetImageGenerator(asset: AVURLAsset(url: input))
    frames.appliesPreferredTrackTransform = true
    frames.requestedTimeToleranceBefore = .zero
    frames.requestedTimeToleranceAfter = .zero
    image = CIImage(cgImage: try await frames.image(at: CMTime(seconds: time, preferredTimescale: 600)).image)
  } else {
    guard let loaded = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]) else { throw Failure("Cannot read \(input.lastPathComponent) as a picture. For a frame of a video, add --at <seconds>.") }
    image = loaded
  }
  let matter = Matter(subject == .auto ? .any : subject)
  var mask = try matter.matte(of: image)
  if mask == nil, subject == .auto {
    matter.subject = .person
    mask = try matter.matte(of: image)
  }
  guard let mask, var box = bounds(of: mask) else { throw Failure("No subject stands out in this picture.") }
  var sticker = cut(image, with: mask)
  if !trim { box = image.extent }
  if outline > 0 {
    // A white rim like a die-cut sticker: the mask grown outward, with a smooth edge.
    let radius = outline * max(box.width, box.height)
    let grow = CIFilter.morphologyMaximum()
    grow.inputImage = mask.cropped(to: image.extent).applyingFilter("CIColorThreshold", parameters: ["inputThreshold": 0.5])
    grow.radius = Float(radius)
    let soft = grow.outputImage!.applyingGaussianBlur(sigma: max(1, radius / 12))
      .applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 4, y: 0, z: 0, w: 0), "inputBiasVector": CIVector(x: -1.5, y: 0, z: 0, w: 0)])
      .applyingFilter("CIColorClamp")
    let rim = CIFilter.blendWithRedMask()
    rim.inputImage = CIImage(color: .white)
    rim.backgroundImage = clear
    rim.maskImage = soft
    sticker = sticker.composited(over: rim.outputImage!)
    box = box.insetBy(dx: -radius * 1.3, dy: -radius * 1.3)
  }
  box = box.integral
  try context.writePNGRepresentation(of: sticker.cropped(to: box), to: output, format: .RGBA8, colorSpace: sRGB)
  print("Saved \(output.lastPathComponent): \(Int(box.width))×\(Int(box.height)) px, \(matter.subject == .person ? "person" : "subject") cut out\(outline > 0 ? " with a white outline" : "")")
}

func video(from input: URL, to output: URL, from start: Double?, to end: Double?, subject: Subject) async throws {
  let asset = AVURLAsset(url: input)
  guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure("\(input.lastPathComponent) has no video. For a picture, name a .png as the output.") }
  let length = try await asset.load(.duration).seconds
  let begin = max(0, start ?? 0)
  let stop = min(length, end ?? length)
  guard stop > begin else { throw Failure("Nothing between \(begin) s and \(stop) s: the video is \(String(format: "%.2f", length)) s long.") }

  // Upright (phone footage is stored rotated) and in standard range (HDR is converted).
  let layout = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset)
  layout.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
  layout.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
  layout.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
  let size = layout.renderSize
  let pixels: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

  let reader = try AVAssetReader(asset: asset)
  reader.timeRange = CMTimeRange(start: CMTime(seconds: begin, preferredTimescale: 600), end: CMTime(seconds: stop, preferredTimescale: 600))
  let frames = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: pixels)
  frames.videoComposition = layout
  reader.add(frames)

  try? FileManager.default.removeItem(at: output)
  let writer = try AVAssetWriter(outputURL: output, fileType: .mov)
  let picture = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.proRes4444, AVVideoWidthKey: size.width, AVVideoHeightKey: size.height,
    AVVideoColorPropertiesKey: [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ],
  ])
  picture.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: picture, sourcePixelBufferAttributes: pixels.merging([
    kCVPixelBufferWidthKey as String: size.width, kCVPixelBufferHeightKey as String: size.height,
  ]) { $1 })
  writer.add(picture)
  guard reader.startReading() else { throw reader.error ?? Failure("Cannot read \(input.lastPathComponent).") }
  guard writer.startWriting() else { throw writer.error ?? Failure("Cannot write \(output.lastPathComponent).") }
  writer.startSession(atSourceTime: .zero)

  let matter = Matter(subject)
  // No colour conversion on the way through: the cutout has to match its own footage exactly when laid back over it.
  let exact = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
  var count = 0
  var empty = 0
  var origin: CMTime?
  while let sample = frames.copyNextSampleBuffer() {
    guard let source = CMSampleBufferGetImageBuffer(sample) else { continue }
    let time = CMSampleBufferGetPresentationTimeStamp(sample)
    if origin == nil { origin = time }
    let image = CIImage(cvPixelBuffer: source)
    if count == 0 { try matter.settle(on: image) }
    let mask = try matter.matte(of: image)
    if mask == nil { empty += 1 }
    var target: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &target)
    guard let target else { throw Failure("Out of memory while writing \(output.lastPathComponent).") }
    exact.render(cut(image, with: mask), to: target, bounds: image.extent, colorSpace: nil)
    // Core Image writes colour already multiplied by alpha; FFmpeg reads ProRes as straight alpha, which would darken soft edges.
    CVPixelBufferLockBaseAddress(target, [])
    var bytes = vImage_Buffer(data: CVPixelBufferGetBaseAddress(target), height: vImagePixelCount(CVPixelBufferGetHeight(target)), width: vImagePixelCount(CVPixelBufferGetWidth(target)), rowBytes: CVPixelBufferGetBytesPerRow(target))
    vImageUnpremultiplyData_RGBA8888(&bytes, &bytes, vImage_Flags(kvImageNoFlags)) // alpha is last in BGRA too
    CVPixelBufferUnlockBaseAddress(target, [])
    while !picture.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
    guard adaptor.append(target, withPresentationTime: time - origin!) else { throw writer.error ?? Failure("Cannot write \(output.lastPathComponent).") }
    count += 1
    if count % 30 == 0 { FileHandle.standardError.write("\(count) frames\n".data(using: .utf8)!) }
  }
  if reader.status == .failed { throw reader.error ?? Failure("Cannot read \(input.lastPathComponent).") }
  picture.markAsFinished()
  await writer.finishWriting()
  if writer.status != .completed { throw writer.error ?? Failure("Cannot write \(output.lastPathComponent).") }
  guard count > empty else {
    try? FileManager.default.removeItem(at: output)
    throw Failure("No \(matter.subject == .person ? "person" : "subject") found in this part of the video.\(matter.subject == .person ? " For an object, add --subject any." : "")")
  }
  let rate = try await track.load(.nominalFrameRate)
  print("Saved \(output.lastPathComponent): \(Int(size.width))×\(Int(size.height)), \(String(format: "%.2f", stop - begin)) s at \(String(format: "%g", rate)) fps, \(matter.subject == .person ? "person" : "subject") cut out"
    + (empty > 0 ? " (\(empty) of \(count) frames had nothing to cut out and are empty)" : ""))
}

// --- Command line ---------------------------------------------------------------------------

var words = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> String? {
  guard let i = words.firstIndex(of: name), i + 1 < words.count else { return nil }
  defer { words.removeSubrange(i...i + 1) }
  return words[i + 1]
}
func number(_ name: String) throws -> Double? {
  guard let text = flag(name) else { return nil }
  guard let value = Double(text) else { throw Failure("\(name) takes a number, not “\(text)”.") }
  return value
}

do {
  let (at, start, end, outline) = (try number("--at"), try number("--from"), try number("--to"), try number("--outline") ?? 0)
  let named = flag("--subject")
  guard let subject = Subject(rawValue: named ?? "auto") else { throw Failure("--subject is any or person, not “\(named!)”.") }
  let trim = !words.contains("--no-trim")
  words.removeAll { $0 == "--no-trim" }
  guard words.count == 2, !words.contains(where: { $0.hasPrefix("--") }) else {
    throw Failure("""
      Usage: cutout <in> <out.png> [--at s] [--subject any|person] [--outline 0.02] [--no-trim]
             cutout <in> <out.mov> [--from s] [--to s] [--subject any|person]
      """)
  }
  let (input, output) = (URL(fileURLWithPath: words[0]), URL(fileURLWithPath: words[1]))
  guard FileManager.default.fileExists(atPath: input.path) else { throw Failure("No such file: \(words[0])") }
  try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
  switch output.pathExtension.lowercased() {
  case "png": try await still(from: input, to: output, at: at, subject: subject, outline: outline, trim: trim)
  case "mov": try await video(from: input, to: output, from: start, to: end, subject: subject)
  default: throw Failure("Name the output .png (a still) or .mov (a video with transparency).")
  }
} catch {
  FileHandle.standardError.write("\(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
