import Image from "next/image";
import { ImagePlus } from "lucide-react";
import type { CSSProperties } from "react";
import type { Book, BookPage, Rect } from "@/domain/book";
import { TEXT_COLORS, coverGeometry, pageGeometry, selectedAsset } from "@/domain/print-spec";
import { cropStyle } from "./ui-helpers";

function rectangleStyle(rect: Rect, width: number, height: number): CSSProperties {
  return {
    left: `${(rect.x / width) * 100}%`,
    top: `${(rect.y / height) * 100}%`,
    width: `${(rect.width / width) * 100}%`,
    height: `${(rect.height / height) * 100}%`,
  };
}

function PreviewText({
  title,
  body,
  rect,
  width,
  height,
  fontSize,
  color,
}: {
  title: string;
  body: string;
  rect: Rect;
  width: number;
  height: number;
  fontSize: number;
  color?: string;
}) {
  return (
    <div
      className="preview-copy"
      style={{
        ...rectangleStyle(rect, width, height),
        fontSize: `${(fontSize / width) * 100}cqw`,
        ...(color ? { color } : {}),
      }}
    >
      {title && <strong>{title}</strong>}
      {body && <p>{body}</p>}
    </div>
  );
}

export function PagePreview({
  book,
  page,
  index,
  guides = true,
}: {
  book: Book;
  page: BookPage;
  index: number;
  guides?: boolean;
}) {
  const geometry = pageGeometry(book.config, book.pages.length, index, page.layout);
  const asset = selectedAsset(page);
  const textRect = page.kind === "text" ? geometry.safe : geometry.text;
  return (
    <div
      className="page-paper"
      style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
      aria-label={`第 ${index + 1} 页近似预览`}
    >
      {page.kind === "illustration" && (
        <div
          className={`preview-image ${asset ? "has-image" : ""}`}
          style={rectangleStyle(geometry.image, geometry.width, geometry.height)}
        >
          {asset ? (
            <Image
              unoptimized
              src={`/api/assets/${asset.id}`}
              alt={page.title || `第 ${index + 1} 页插画`}
              width={asset.width}
              height={asset.height}
              style={cropStyle(asset, geometry.image, page.zoom, page.offsetX, page.offsetY)}
            />
          ) : (
            <div className="image-placeholder">
              <ImagePlus strokeWidth={1} size={35} />
              <span>给故事留一个位置</span>
              <small>生成或导入后，亲手选一张图</small>
            </div>
          )}
        </div>
      )}
      {page.kind === "illustration" && page.layout === "full" && (page.title || page.text) && (
        <div
          className="preview-panel"
          style={rectangleStyle(
            {
              x: textRect.x - 8,
              y: textRect.y - 8,
              width: textRect.width + 16,
              height: textRect.height + 8,
            },
            geometry.width,
            geometry.height,
          )}
        />
      )}
      {page.kind !== "blank" && (
        <PreviewText
          title={page.title}
          body={page.text}
          rect={textRect}
          width={geometry.width}
          height={geometry.height}
          fontSize={page.fontSize}
          color={TEXT_COLORS[page.textColor].hex}
        />
      )}
      {guides && (
        <>
          <div
            className="trim-guide"
            style={rectangleStyle(geometry.trim, geometry.width, geometry.height)}
          />
          <div
            className="safe-guide"
            style={rectangleStyle(geometry.safe, geometry.width, geometry.height)}
          />
        </>
      )}
    </div>
  );
}

export function CoverPreview({ book }: { book: Book }) {
  const geometry = coverGeometry(book.config, book.pages.length);
  const asset = selectedAsset(book.cover);
  return (
    <div
      className="cover-paper"
      style={{
        aspectRatio: `${geometry.width} / ${geometry.height}`,
        background: book.cover.background,
      }}
      aria-label="封底、书脊与封面展开近似预览"
    >
      <div
        className="cover-art"
        style={rectangleStyle(geometry.image, geometry.width, geometry.height)}
      >
        {asset && (
          <Image
            unoptimized
            src={`/api/assets/${asset.id}`}
            alt="封面候选插画"
            width={asset.width}
            height={asset.height}
            style={cropStyle(asset, geometry.image)}
          />
        )}
      </div>
      <div
        className="preview-panel"
        style={rectangleStyle(geometry.headingPanel, geometry.width, geometry.height)}
      />
      <PreviewText
        title={book.cover.title}
        body={book.cover.author}
        rect={geometry.heading}
        width={geometry.width}
        height={geometry.height}
        fontSize={26}
      />
      <PreviewText
        title=""
        body={book.cover.description}
        rect={geometry.backText}
        width={geometry.width}
        height={geometry.height}
        fontSize={18}
      />
      <div
        className="spine-guide"
        style={{
          left: `${((9 + geometry.back.width) / geometry.width) * 100}%`,
          width: `${(geometry.spine / geometry.width) * 100}%`,
        }}
      />
      <div
        className="barcode"
        role="img"
        aria-label="条码预留空白区，不放置内容"
        style={rectangleStyle(geometry.barcode, geometry.width, geometry.height)}
      />
    </div>
  );
}
