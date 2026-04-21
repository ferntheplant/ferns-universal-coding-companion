import { useAtom } from "jotai";
import { fileCommentTextAtomFamily } from "../state/comments";

export function Comments({ fileId }: { fileId: string }) {
  const [comment, setComment] = useAtom(fileCommentTextAtomFamily(fileId));

  return (
    <section className="comments">
      <label className="comments__label" htmlFor={`comment-${fileId}`}>
        File comment
      </label>
      <textarea
        id={`comment-${fileId}`}
        className="comments__input"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Write a file-level comment..."
      />
    </section>
  );
}
