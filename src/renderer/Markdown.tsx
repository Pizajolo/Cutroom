/** Just enough markdown for chat replies and storyboards: headings, **bold**, *italic*, project images and line breaks. */
export function Markdown({ text }: { text: string }) {
  return text.split('\n').map((line, i) => {
    const image = /^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/.exec(line);
    if (image) return <img key={i} src={`media://project/${encodeURI(image[1]!)}`} alt="" />;
    const heading = /^#{1,3} (.*)$/.exec(line);
    const pieces = (heading?.[1] ?? line).split(/(\*\*.+?\*\*|\*.+?\*)/g).map((piece, n) => {
      if (piece.startsWith('**')) return <strong key={n}>{piece.slice(2, -2)}</strong>;
      if (piece.length > 2 && piece.startsWith('*')) return <em key={n}>{piece.slice(1, -1)}</em>;
      return piece;
    });
    return heading ? <h3 key={i}>{pieces}</h3> : <p key={i}>{pieces}</p>;
  });
}
