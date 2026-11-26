// Renders pages of a PDF to PNG with Apple's PDFKit, for picking a logo out of a brand guideline.
//   cutroom-pdfpage <in.pdf>                      prints the number of pages
//   cutroom-pdfpage <in.pdf> <out-dir> <page>…    one PNG per page (1-based), longest side 2400 px,
//                                                transparent where the page has nothing drawn
// Prints one line per page: "<page> <file> <width>x<height>".
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2, let document = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  fail("Cannot open \(args.count >= 2 ? args[1] : "the PDF") as a PDF.")
}
if args.count == 2 {
  print("\(document.pageCount) pages")
  exit(0)
}
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let longest: CGFloat = 2400
let name = URL(fileURLWithPath: args[1]).deletingPathExtension().lastPathComponent

for value in args.dropFirst(3) {
  guard let number = Int(value), number >= 1, number <= document.pageCount, let page = document.page(at: number - 1) else {
    fail("There is no page \(value); the PDF has \(document.pageCount).")
  }
  let box = page.bounds(for: .cropBox)
  let turned = page.rotation % 180 != 0
  let (pageW, pageH) = turned ? (box.height, box.width) : (box.width, box.height)
  let scale = longest / max(pageW, pageH)
  let width = Int((pageW * scale).rounded()), height = Int((pageH * scale).rounded())
  guard let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { fail("Cannot draw page \(number).") }
  context.interpolationQuality = .high
  context.scaleBy(x: scale, y: scale)
  // PDFKit draws the page upright, rotation included, into a box of the page's displayed size.
  page.draw(with: .cropBox, to: context)
  guard let image = context.makeImage() else { fail("Cannot draw page \(number).") }
  let out = outDir.appendingPathComponent("\(name)-p\(number).png")
  guard let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fail("Cannot write \(out.path).")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fail("Cannot write \(out.path).") }
  print("\(number) \(out.path) \(width)x\(height)")
}
