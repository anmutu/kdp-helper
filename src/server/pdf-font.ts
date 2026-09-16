import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

export async function embedCffFontProgram(document: PDFDocument, source: Buffer) {
  if (source.subarray(0, 4).toString() !== "OTTO")
    throw new Error("Expected the bundled OpenType CFF font.");
  let table: Buffer | undefined;
  const count = source.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const cursor = 12 + index * 16;
    if (source.subarray(cursor, cursor + 4).toString() === "CFF ") {
      const offset = source.readUInt32BE(cursor + 8),
        length = source.readUInt32BE(cursor + 12);
      if (offset + length > source.length) throw new Error("Invalid CFF table length.");
      table = source.subarray(offset, offset + length);
      break;
    }
  }
  if (!table || table[0] !== 1)
    throw new Error("The bundled font must contain a CFF 1 font program.");
  await document.flush();
  const program = document.context.register(
    document.context.flateStream(table, { Subtype: PDFName.of("CIDFontType0C") }),
  );
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of("Type"))?.toString() === "/FontDescriptor") {
      for (const key of ["FontFile2", "FontFile3"]) {
        const previous = object.get(PDFName.of(key));
        if (previous instanceof PDFRef) document.context.delete(previous);
        object.delete(PDFName.of(key));
      }
      object.set(PDFName.of("FontFile3"), program);
    }
    if (object.get(PDFName.of("Subtype"))?.toString() === "/CIDFontType2") {
      object.set(PDFName.of("Subtype"), PDFName.of("CIDFontType0"));
      object.delete(PDFName.of("CIDToGIDMap"));
    }
  }
}
