import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import {
  createDocLayout,
  DocLayoutError,
  type DocLayoutDetector,
  type DocLayoutResult
} from "web-sdk-pp-doclayoutv3";

export function App(): ReactElement {
  const detector = useRef<DocLayoutDetector | undefined>(undefined);
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState("请选择图片");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DocLayoutResult>();
  const [error, setError] = useState<{ code?: string; message: string }>();

  useEffect(() => {
    return () => {
      void detector.current?.dispose();
    };
  }, []);

  const selectImage = (event: ChangeEvent<HTMLInputElement>): void =>
    setFile(event.target.files?.[0]);
  const detect = async (): Promise<void> => {
    if (file === undefined) return;
    setError(undefined);
    try {
      await detector.current?.dispose();
      detector.current = await createDocLayout({
        onProgress: (event) => {
          setStatus(`${event.phase}: ${event.status}`);
          if (event.totalBytes !== undefined)
            setProgress(((event.loadedBytes ?? 0) / event.totalBytes) * 100);
        }
      });
      setResult(await detector.current.detect(file, { threshold: 0.5 }));
      setProgress(100);
      setStatus("检测完成");
    } catch (caught) {
      setError(
        caught instanceof DocLayoutError
          ? { code: caught.code, message: caught.message }
          : { message: String(caught) }
      );
    }
  };

  return (
    <main>
      <h1>React 示例</h1>
      <input type="file" accept="image/*" onChange={selectImage} />
      <button onClick={() => void detect()}>检测</button>
      <p>{status}</p>
      <progress max="100" value={progress} />
      <pre>
        {error ? JSON.stringify(error, null, 2) : result ? JSON.stringify(result, null, 2) : ""}
      </pre>
    </main>
  );
}
