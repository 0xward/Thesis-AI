import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import axios from 'axios';
import * as cheerio from 'cheerio';

import PDFParser from 'pdf2json';

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/fetch-url', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Remove scripts, styles, etc.
      $('script, style, noscript, iframe, img, svg').remove();
      
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      
      res.json({ text: text.substring(0, 100000) }); // Limit to avoid massive responses
    } catch (error: any) {
      console.error('Fetch URL error:', error.message);
      res.status(500).json({ error: 'Failed to fetch URL content' });
    }
  });

  app.post('/api/parse-pdf', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

            const pdfParser = new PDFParser();
      const text = await new Promise<string>((resolve, reject) => {
        pdfParser.on('pdfParser_dataError', (errData: any) => reject(errData.parserError));
        pdfParser.on('pdfParser_dataReady', () => {
          const pages = (pdfParser as any).data.Pages;
          let extractedText = '';
          for (const page of pages) {
            for (const textItem of page.Texts) {
              extractedText += decodeURIComponent(textItem.R[0].T) + ' ';
            }
          }
          resolve(extractedText);
        });
        pdfParser.parseBuffer(req.file!.buffer);
      });
      if (!text) {
        throw new Error('PDF parsing resulted in empty or invalid data');
      }
      res.json({ text });
    } catch (error: any) {
      console.error('PDF Parse Error Detail:', error);
      res.status(500).json({ error: 'Failed to parse PDF: ' + (error.message || 'Unknown error') });
    }
  });

  app.post('/api/export-docx', async (req, res) => {
    try {
      const { markdown, title } = req.body;
      if (!markdown) return res.status(400).json({ error: 'Markdown content is required' });

      // Dynamically import marked and html-to-docx to avoid top-level issues if they are ESM/CJS mixed
      const { marked } = await import('marked');
      const HTMLToDOCX = (await import('html-to-docx')).default || await import('html-to-docx');
      
      // Convert Markdown to HTML
      const htmlContent = await marked.parse(markdown);
      
      // Add font and styling wrapper for DOCX
      // Inject page breaks and better formatting for BAB headers
      const processedHtml = htmlContent.replace(/<h1>BAB (.*?)[:\-\n](.*?)<\/h1>/gi, (match, bab, title) => {
        return `<div style="page-break-before: always;"></div><h1 style="text-align: center; line-height: 1.2;">
          BAB ${bab.trim()}<br>${title.trim()}
        </h1>`;
      });
      
      const finalHtml = processedHtml.replace(/<h1>(?!BAB)(.*?)<\/h1>/gi, '<div style="page-break-before: always;"></div><h1 style="text-align: center;">$1</h1>');

      const styledHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2;">${finalHtml}</div></body></html>`;

      // The html-to-docx library usually exports default or module.exports
      // We handle both cases using dynamic import
      
      const generator = typeof HTMLToDOCX === 'function' ? HTMLToDOCX : (HTMLToDOCX as any).default;

      // Indonesian Skripsi Margins (Twips): 
      // Top 3cm = 1701, Bottom 3cm = 1701, Right 3cm = 1701, Left 4cm = 2268
      const docxBuffer = await generator(styledHtml, null, {
        title: title || 'Thesis',
        margins: { top: 1700, right: 1700, bottom: 1700, left: 2270 },
        pageSize: { width: 11906, height: 16838 } // A4 Size in twips
      });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${(title || 'Thesis').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx"`);
      res.send(docxBuffer);
    } catch (error: any) {
      console.error('DOCX Export error:', error.message);
      res.status(500).json({ error: 'Failed to generate DOCX' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    // Only serve static files if not on Vercel
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
  
  return app;
}

const appPromise = startServer();
export default async (req: any, res: any) => {
  const app = await appPromise;
  app(req, res);
};
