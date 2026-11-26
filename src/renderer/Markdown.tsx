/** Just enough markdown for chat replies and storyboards: headings, lists, **bold**, *italic*, project images and line breaks. */
export function Markdown({ text }: { text: string }) {
  return text.split('\n').map((line, i) => {
    const image = /^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/.exec(line);
    if (image) return <img key={i} src={`media://project/${encodeURI(image[1]!)}`} alt="" />;
    const heading = /^#{1,3} (.*)$/.exec(line);
    const item = heading ? null : /^(\s*)[-*] (.*)$/.exec(line);
    const pieces = (heading?.[1] ?? item?.[2] ?? line).split(/(\*\*.+?\*\*|\*.+?\*)/g).map((piece, n) => {
      if (piece.startsWith('**')) return <strong key={n}>{piece.slice(2, -2)}</strong>;
      if (piece.length > 2 && piece.startsWith('*')) return <em key={n}>{piece.slice(1, -1)}</em>;
      return piece;
    });
    // A storyboard shot's "Technique: @move — why" (or "Technique: new — name") stands out as a label.
    const technique = !heading && !item && /^Technique:\s*(.*)$/i.exec(line);
    if (technique) {
      const isNew = /^new\b/i.test(technique[1]!);
      return <p key={i} className={`technique${isNew ? ' new' : ''}`}><span className="tag">{isNew ? 'New move' : 'Technique'}</span> {pieces.map((p) => (typeof p === 'string' ? p.replace(/^Technique:\s*(new\s*[—–-]\s*)?/i, '') : p))}</p>;
    }
    if (item) return <p key={i} className="li" style={{ marginLeft: `${Math.min(3, Math.floor(item[1]!.length / 2)) * 1.1}em` }}>{pieces}</p>;
    return heading ? <h3 key={i}>{pieces}</h3> : <p key={i}>{pieces}</p>;
  });
}
