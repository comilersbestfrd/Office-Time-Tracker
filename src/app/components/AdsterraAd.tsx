import React, { useEffect, useRef } from 'react';

interface AdsterraAdProps {
  adKey: string;
  width: number;
  height: number;
}

export default function AdsterraAd({ adKey, width, height }: AdsterraAdProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 0;
              overflow: hidden;
              display: flex;
              justify-content: center;
              align-items: center;
              background: transparent;
            }
          </style>
        </head>
        <body>
          <script type="text/javascript">
            window.atOptions = {
              'key' : '${adKey}',
              'format' : 'iframe',
              'height' : ${height},
              'width' : ${width},
              'params' : {}
            };
          </script>
          <script type="text/javascript" src="https://www.highperformanceformat.com/${adKey}/invoke.js"></script>
        </body>
      </html>
    `);
    doc.close();
  }, [adKey, width, height]);

  return (
    <div style={{ width, height, display: 'flex', justifyContent: 'center', margin: '0.75rem auto' }}>
      <iframe
        ref={iframeRef}
        width={width}
        height={height}
        frameBorder="0"
        scrolling="no"
        style={{ border: 'none', background: 'transparent' }}
      />
    </div>
  );
}
