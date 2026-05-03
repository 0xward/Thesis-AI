import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Link, Upload, BookOpen, Settings, Play, CheckCircle, Download, Loader2, ArrowRight, ChevronDown, ChevronRight, Wand2, RotateCcw, LogOut, LayoutDashboard, Save, Trash2, Clock, Globe, Info, Heart, Share } from 'lucide-react';
import { cn } from './lib/utils';
import axios from 'axios';
import Markdown from 'react-markdown';
import ChatAssistant from './components/ChatAssistant';
import { MiniPayAction } from './components/MiniPayAction';

import { ThesisConfig, ResearchSource, ThesisStructure, generateThesisStructure, generateChapterContentStream, ChapterDefinition, generateTitleOptions, generateReferences } from './services/aiService';
import { auth, googleProvider, db } from './lib/firebase';
import { signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, onSnapshot, increment, updateDoc, setDoc, getDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { thesisPersistenceService, ThesisData } from './thesisPersistenceService';

interface Revision {
  id: string;
  timestamp: Date;
  structure: ThesisStructure;
  generatedThesis: { chapterTitle: string, content: string }[];
}

export default function App() {
  const [lang, setLang] = useState<'en' | 'id'>('en');
  const [showAbout, setShowAbout] = useState(false);
  const [showCoffee, setShowCoffee] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'generator' | 'dashboard'>('generator');
  const [visitorCount, setVisitorCount] = useState<number>(0);
  const [savedTheses, setSavedTheses] = useState<ThesisData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTheses, setIsLoadingTheses] = useState(false);

  useEffect(() => {
    // Visitor tracking
    const visitorRef = doc(db, 'visitors', 'stats');
    
    // Increment visit (simple)
    const incrementVisit = async () => {
      try {
        const snap = await getDoc(visitorRef).catch(() => null);
        if (!snap || !snap.exists()) {
          await setDoc(visitorRef, { count: 1 }).catch(() => {});
        } else {
          await updateDoc(visitorRef, { count: increment(1) }).catch(() => {});
        }
      } catch (error) {
        if (error.message && error.message.includes("Missing or insufficient permissions")) {
          // Silently fail if rules aren't updated
        } else {
          console.error("Failed to increment visit", error);
        }
      }
    };
    incrementVisit();

    // Listen to visitors
    const unsubVisitors = onSnapshot(visitorRef, (snap) => {
        if(snap.exists()) setVisitorCount(snap.data().count);
    }, (error) => {
        if (error.message && error.message.includes("Missing or insufficient permissions")) {
          // Silently fail if rules aren't updated
        } else {
          console.error("Failed to listen to visitors", error);
        }
    });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        loadUserTheses();
      } else {
        setSavedTheses([]);
      }
    });

    return () => {
        unsubscribe();
        unsubVisitors();
    }
  }, []);

  const loadUserTheses = async () => {
    setIsLoadingTheses(true);
    try {
      const data = await thesisPersistenceService.getUserTheses();
      setSavedTheses(data);
    } catch (e) {
      console.error("Failed to load user theses", e);
      setSavedTheses([]);
    }
    setIsLoadingTheses(false);
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Full Login Error:", e);
      let errorDetail = "";
      if (e.code === 'auth/unauthorized-domain') {
        errorDetail = "\n\nPastikan domain vercel kamu sudah ditambahkan di Firebase Console -> Authentication -> Settings -> Authorized domains.";
      }
      alert(`Login failed: ${e.code} - ${e.message}${errorDetail}`);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setStep(1);
      setView('generator');
    } catch (e: any) {
      alert("Logout failed: " + e.message);
    }
  };

  const t = (key: keyof typeof translations['en']) => {
    const dict = translations[lang] || translations.en;
    return dict[key] || translations.en[key] || key;
  };

  const translations = {
    en: {
      tagline: "Autonomous Research Agent",
      create: "Create",
      dashboard: "Dashboard",
      about: "About",
      signIn: "Sign In",
      signOut: "Sign Out",
      newThesis: "New Thesis",
      myLibrary: "My Research Library",
      manageDrafts: "Manage your saved thesis drafts and research work.",
      noSavedFound: "No Saved Theses Found",
      startGenerating: "Start generating a thesis and save it to see it here in your personal library.",
      initiate: "Initiate Generation",
      openDraft: "Open Draft",
      saveDraft: "Save Draft",
      exportPptx: "Export PPTX",
      exportPdf: "Export PDF",
      regenerate: "Regenerate Chapter",
      aboutTitle: "About ThesisAI",
      aboutDesc: "ThesisAI is a high-performance Autonomous Research Agent designed to streamline academic writing. It synthesizes complex information from your provided knowledge base into structured, properly formatted academic prose.",
      disclaimerTitle: "Disclaimer & Ethics",
      disclaimerDesc: "This tool is an AI assistant. AI can hallucinate or produce inaccurate information. Always verify facts and citations. ThesisAI is intended to assist, not replace, critical thinking. Use responsibly and adhere to your institution's academic integrity guidelines.",
      donationTitle: "Support the Project",
      donationDesc: "This project is developed independently to help students worldwide. If you find it helpful, consider supporting the maintenance and further development.",
      languageName: "English",
      saveConfirmation: "Thesis saved successfully!",
      loginRequirement: "Please login first to save your progress.",
      revertConfirmation: "Are you sure you want to revert to this version? Any unsaved changes in the current view will be lost.",
      step1Title: "Knowledge Base",
      step1Desc: "Upload PDFs, paste URLs, or enter raw text to guide the AI's research.",
      addUrl: "Add URL",
      pasteText: "Paste Text",
      configureTitle: "Refine Output",
      major: "Academic Major",
      thesisLevel: "Thesis Level",
      writingStyle: "Writing Style",
      citationStyle: "Citation Style",
      generateFull: "Generate Full Thesis",
      processing: "Processing...",
      thesisTitle: "Thesis Title (Optional)",
      titlePlaceholder: "Let AI decide or type your own...",
      generateTitles: "Generate Title Options based on sources",
      antiPlagiarismDesc: "Naturally paraphrases to reduce similarity score.",
      language: "Target Language",
      contentLength: "Content Length",
      fontProfile: "Font Profile",
      antiPlagiarism: "Anti-Plagiarism",
    },
    id: {
      tagline: "Agen Riset Otonom",
      create: "Buat",
      dashboard: "Dasbor",
      about: "Tentang",
      signIn: "Masuk",
      signOut: "Keluar",
      newThesis: "Skripsi Baru",
      myLibrary: "Perpustakaan Riset Saya",
      manageDrafts: "Kelola draf skripsi dan karya riset Anda yang tersimpan.",
      noSavedFound: "Tidak Ada Skripsi Tersimpan",
      startGenerating: "Mulai buat skripsi dan simpan untuk melihatnya di sini di perpustakaan pribadi Anda.",
      initiate: "Mulai Pembuatan",
      openDraft: "Buka Draf",
      saveDraft: "Simpan Draf",
      exportPptx: "Ekspor PPTX",
      exportPdf: "Ekspor PDF",
      regenerate: "Buat Ulang Bab",
      aboutTitle: "Tentang ThesisAI",
      aboutDesc: "ThesisAI adalah Agen Riset Otonom berperforma tinggi yang dirancang untuk mempermudah penulisan akademik. Sistem ini menyatukan informasi kompleks dari pangkalan pengetahuan Anda menjadi prosa akademik yang terstruktur dan terformat dengan benar.",
      disclaimerTitle: "Sanggahan & Etika",
      disclaimerDesc: "Alat ini adalah asisten AI. AI dapat memberikan informasi yang tidak akurat (halusinasi). Selalu verifikasi fakta dan sitasi. ThesisAI dimaksudkan untuk membantu, bukan menggantikan pemikiran kritis. Gunakan secara bertanggung jawab dan patuhi pedoman integritas akademik institusi Anda.",
      donationTitle: "Dukung Proyek Ini",
      donationDesc: "Proyek ini dikembangkan secara independen untuk membantu pelajar di seluruh dunia. Jika Anda merasa terbantu, pertimbangkan untuk mendukung biaya pemeliharaan dan pengembangan lebih lanjut.",
      languageName: "Bahasa Indonesia",
      saveConfirmation: "Skripsi berhasil disimpan!",
      loginRequirement: "Silakan masuk terlebih dahulu untuk menyimpan progres Anda.",
      revertConfirmation: "Apakah Anda yakin ingin kembali ke versi ini? Perubahan yang belum disimpan akan hilang.",
      step1Title: "Pangkalan Pengetahuan",
      step1Desc: "Unggah PDF, tempel URL, atau masukkan teks mentah untuk memandu riset AI.",
      addUrl: "Tambah URL",
      pasteText: "Tempel Teks",
      configureTitle: "Sempurnakan Output",
      major: "Program Studi",
      thesisLevel: "Jenjang",
      writingStyle: "Gaya Penulisan",
      citationStyle: "Gaya Sitasi",
      generateFull: "Buat Skripsi Lengkap",
      processing: "Memproses...",
      thesisTitle: "Judul (Opsional)",
      titlePlaceholder: "Biarkan AI memutuskan...",
      generateTitles: "Buat Pilihan Judul",
      antiPlagiarismDesc: "Parafrase alami untuk mengurangi skor kesamaan.",
      language: "Bahasa Target",
      contentLength: "Panjang Konten",
      fontProfile: "Profil Font",
      antiPlagiarism: "Anti-Plagiarisme",
    }
  };

  const saveThesis = async () => {
    if (!user) {
      alert(t('loginRequirement'));
      login();
      return;
    }
    if (!structure || generatedThesis.length === 0) return;

    setIsSaving(true);
    try {
      await thesisPersistenceService.saveThesis({
        title: structure.title,
        config,
        structure,
        generatedThesis,
        sources,
      });
      alert(t('saveConfirmation'));
      loadUserTheses();
    } catch (e: any) {
      alert("Failed to save: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteThesis = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this thesis?")) return;
    try {
      await thesisPersistenceService.deleteThesis(id);
      loadUserTheses();
    } catch (e: any) {
      alert("Failed to delete: " + e.message);
    }
  };

  const loadThesisFromSave = (thesis: ThesisData) => {
    setStructure(thesis.structure);
    setGeneratedThesis(thesis.generatedThesis);
    setSources(thesis.sources);
    setConfig(thesis.config);
    setTitleInput(thesis.title);
    setStep(3);
    setIsFinished(true);
    setView('generator');
  };

  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);

  const [config, setConfig] = useState<ThesisConfig>({
    targetLanguage: 'English',
    major: 'Computer Science',
    thesisLevel: 'Undergraduate Thesis',
    writingStyle: 'Formal Academic',
    contentLength: 'Standard',
    fontFamily: 'Serif',
    antiPlagiarism: true,
    citationStyle: 'APA 7th Edition',
  });

  const [titleInput, setTitleInput] = useState('');
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Input, 2: Generating Structure, 3: Generating Content & Done
  const [structure, setStructure] = useState<ThesisStructure | null>(null);
  const [generatedThesis, setGeneratedThesis] = useState<{ chapterTitle: string, content: string }[]>([]);
  const [currentGeneratingChapter, setCurrentGeneratingChapter] = useState<number>(-1);
  const [currentStreamedText, setCurrentStreamedText] = useState('');
  const [isFinished, setIsFinished] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [viewingSource, setViewingSource] = useState<ResearchSource | null>(null);

  const revertToRevision = (rev: Revision) => {
    if (!window.confirm(t('revertConfirmation'))) return;
    setStructure(rev.structure);
    setGeneratedThesis(rev.generatedThesis);
    setIsFinished(true);
    setCurrentGeneratingChapter(-1);
    setCurrentStreamedText('');
  };

  const toggleChapter = (idx: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };


  const addUrlSource = async () => {
    if (!urlInput.trim()) return;
    setIsFetchingUrl(true);
    try {
      const res = await axios.post('/api/fetch-url', { url: urlInput });
      if (res.data.text) {
        setSources(prev => [...prev, { 
          type: 'url', 
          content: res.data.text, 
          title: res.data.title || urlInput 
        }]);
        setUrlInput('');
      } else {
        alert('Failed to extract text from URL.');
      }
    } catch (e: any) {
      const errorData = e.response?.data?.error;
      const errorDetail = e.response?.data?.detail;
      const errorMsg = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
      alert(`Error fetching URL: ${errorMsg || e.message}${errorDetail ? '\n\n' + errorDetail : ''}`);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const addTextSource = () => {
    // Paste text removed
  };

  const removeSource = (index: number) => {
    setSources(prev => prev.filter((_, i) => i !== index));
  };

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const startGeneration = async () => {
    if (sources.length === 0) {
      alert("Please provide at least one source (PDF, URL, or Text) before generating.");
      return;
    }
    
    setIsGenerating(true);
    setStatusMessage("Synthesizing Core Structure...");
    setStep(2);
    try {
      const struct = await generateThesisStructure(sources, config, titleInput.trim() || undefined);
      setStructure(struct);
      setStep(3);
      await generateFullThesis(struct);
    } catch (e: any) {
      console.error(e);
      alert("Error generating thesis structure: " + e.message);
      setStep(1);
    } finally {
      setIsGenerating(false);
      setStatusMessage(null);
    }
  };

  const handleGenerateTitles = async () => {
    if (sources.length === 0) {
      alert("Please provide at least one source to generate titles.");
      return;
    }
    setIsGeneratingTitles(true);
    try {
      const options = await generateTitleOptions(sources, config);
      setTitleOptions(options);
    } catch (e: any) {
      alert("Error generating titles: " + e.message);
    } finally {
      setIsGeneratingTitles(false);
    }
  };

  const generateFullThesis = async (struct: ThesisStructure) => {
    const results: { chapterTitle: string, content: string }[] = [];
    let previousContext = "";

    setIsFinished(false);

    for (let i = 0; i < struct.chapters.length; i++) {
      const chapter = struct.chapters[i];
      setCurrentGeneratingChapter(i);
      setCurrentStreamedText('');
      
      try {
        const stream = await generateChapterContentStream(chapter, struct, sources, config, previousContext);
        let chapterContent = "";
        
        for await (const chunk of stream) {
          chapterContent += (chunk as any).text || '';
          setCurrentStreamedText(chapterContent);
        }
        
        results.push({ chapterTitle: chapter.chapter_title, content: chapterContent });
        setGeneratedThesis([...results]);
        
        previousContext += `\n\nChapter ${i+1} (${chapter.chapter_title}) Summary: ${chapterContent.substring(0, 1000)}...`;
        if (previousContext.length > 10000) previousContext = previousContext.slice(-10000);
      } catch (e: any) {
        console.error("Error generating chapter", i, e);
        results.push({ chapterTitle: chapter.chapter_title, content: `Error generating chapter: ${e.message}\n` });
        setGeneratedThesis([...results]);
      }
    }

    setCurrentGeneratingChapter(-1);
    setCurrentStreamedText('');
    setIsFinished(true);

    const newRevision: Revision = {
      id: Date.now().toString(),
      timestamp: new Date(),
      structure: struct,
      generatedThesis: [...results]
    };
    setRevisions(prev => [newRevision, ...prev]);
  };

  const handleRegenerate = async () => {
    if (!structure) return;
    if (!window.confirm("Are you sure you want to regenerate the thesis? This will create a new revision.")) return;
    setGeneratedThesis([]);
    await generateFullThesis(structure);
  };

  const [isGeneratingReferences, setIsGeneratingReferences] = useState(false);
  const handleGenerateReferences = async () => {
    if (!structure) return;
    setIsGeneratingReferences(true);
    try {
      const refChapter = await generateReferences(sources, config);
      
      const newStructure = { ...structure, chapters: [...structure.chapters, { chapter_title: refChapter.chapterTitle, summary: 'References list', subchapters: [] }] };
      setStructure(newStructure);
      
      const newThesis = [...generatedThesis, refChapter];
      setGeneratedThesis(newThesis);

      const newRevision: Revision = {
        id: Date.now().toString(),
        timestamp: new Date(),
        structure: newStructure,
        generatedThesis: newThesis
      };
      setRevisions(prev => [newRevision, ...prev]);

    } catch (e: any) {
      alert("Error generating references: " + e.message);
    } finally {
      setIsGeneratingReferences(false);
    }
  };

  const getThesisMarkdown = () => {
    if (!structure) return "";
    let md = `# ${structure.title}\n\n`;
    
    md += `## Table of Contents\n\n`;
    structure.chapters.forEach((ch, idx) => {
      md += `${idx + 1}. ${ch.chapter_title}\n`;
      if (ch.subchapters && ch.subchapters.length > 0) {
        ch.subchapters.forEach(sub => {
          md += `   - ${sub}\n`;
        });
      }
    });
    md += `\n---\n\n`;

    generatedThesis.forEach(ch => {
      md += `${ch.content.replace(/\\s*\\[SRC_\\d+\\]/g, '')}\n\n`;
    });
    
    return md;
  };

  const downloadMarkdown = () => {
    if (!structure) return;
    const md = getThesisMarkdown();
    const element = document.createElement("a");
    const file = new Blob([md], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = `${structure.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const downloadDocx = async () => {
    if (!structure) return;
    const md = getThesisMarkdown();
    try {
      const response = await axios.post('/api/export-docx', { markdown: md, title: structure.title }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${structure.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (e: any) {
      alert("Failed to export DOCX: " + e.message);
    }
  };

  const downloadPdf = async () => {
    if (!structure || generatedThesis.length === 0) return;
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const { marked } = await import('marked');
      const md = getThesisMarkdown();
      let htmlContent = await marked.parse(md);
      
      // Delay to ensure DOM rendering
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Inject page breaks and better formatting for sections
      htmlContent = htmlContent.replace(/<h1>BAB (.*?)[:\-\n](.*?)<\/h1>/gi, (match, bab, title) => {
        return `<div style="page-break-before: always;"></div><h1 style="text-align: center; line-height: 1.2;">
          <span style="display: block; margin-bottom: 5px;">BAB ${bab.trim()}</span>
          <span style="display: block;">${title.trim()}</span>
        </h1>`;
      });
      
      // Fallback for other H1s
      htmlContent = htmlContent.replace(/<h1>(?!BAB)(.*?)<\/h1>/gi, '<div style="page-break-before: always;"></div><h1 style="text-align: center;">$1</h1>');
      
      const container = document.createElement('div');
      container.className = cn(
        "academic-paper-export",
        config.fontFamily === 'Serif' ? "academic-paper-serif" : "academic-paper-sans"
      );
      
      // Inline styles for export to ensure consistency
      const styleTag = document.createElement('style');
      styleTag.innerHTML = `
        .academic-paper-export {
          background: white;
          color: black;
          font-size: 12pt;
          line-height: 2;
          text-align: justify;
        }
        .academic-paper-export h1 {
          font-size: 14pt;
          text-align: center;
          text-transform: uppercase;
          margin-bottom: 2rem;
          font-weight: bold;
        }
        .academic-paper-export h2 {
          font-size: 12pt;
          font-weight: bold;
          margin-top: 1.5rem;
          margin-bottom: 1rem;
        }
        .academic-paper-export p {
          text-indent: 1.25cm;
          margin-bottom: 0px; 
          padding-bottom: 0px;
          page-break-inside: auto; /* Allow paragraphs to split if too long */
          line-height: 1.6 !important;
          orphans: 3;
          widows: 3;
        }
        .academic-paper-export h1, .academic-paper-export h2, .academic-paper-export h3 {
          text-indent: 0 !important;
          page-break-after: avoid;
          page-break-inside: avoid;
        }
      `;
      
      container.innerHTML = htmlContent;
      container.prepend(styleTag);
      
      document.body.appendChild(container);
      
      const titleSafe = structure.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      // Indonesian Skripsi Margins (Inches): Top 3cm=1.18, Left 4cm=1.57, Bottom 3cm=1.18, Right 3cm=1.18
      const opt = {
        margin: [1.18, 1.57, 1.18, 1.18] as [number, number, number, number],
        filename: `${titleSafe}.pdf`,
        image: { type: 'jpeg' as const, quality: 1.0 },
        html2canvas: { 
          scale: 2.5, // Balanced scale
          useCORS: true, 
          logging: false,
          letterRendering: true,
          scrollY: 0
        },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' as const, compress: true },
        pagebreak: { mode: ['css', 'legacy'] }
      };

      await html2pdf().from(container).set(opt).save();
      document.body.removeChild(container);
    } catch (e: any) {
      alert("Failed to export PDF: " + e.message);
    }
  };

  const downloadPptx = async () => {
    if (!structure || generatedThesis.length === 0) return;
    try {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pres = new PptxGenJS();
      let slide = pres.addSlide();
      slide.background = { color: "0C0D10" };
      slide.addText(structure.title, { x: 0.5, y: 3.5, w: "90%", h: 1, fontSize: 36, color: "F0F1F3", italic: true, align: "center", fontFace: "Georgia" });
      slide.addText(`${config.thesisLevel} | ${config.major}`, { x: 0.5, y: 4.5, w: "90%", h: 0.5, fontSize: 14, color: "B59A6D", align: "center", bold: true });
      pres.writeFile({ fileName: `${structure.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pptx` });
    } catch (e: any) {
      alert("Failed to export PPTX: " + e.message);
    }
  };

  const shareThesis = async () => {
    if (!structure) return;
    const shareData = {
      title: structure.title,
      text: `Check out my research generated by ThesisAI: ${structure.title}`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        console.log("Sharing not supported on this browser.");
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.error("Error sharing:", err);
      }
    }
  };

  const markdownComponents = {
    h1: ({ children }: any) => {
      // Robust text extraction from children
      const getText = (nodes: any): string => {
        return React.Children.toArray(nodes)
          .map((node: any) => {
            if (typeof node === 'string') return node;
            if (node.props && node.props.children) return getText(node.props.children);
            return '';
          })
          .join('');
      };

      const text = getText(children);
      if (text.toUpperCase().includes('BAB ')) {
        const parts = text.split(/[:\-\n]/);
        if (parts.length > 1) {
          return (
            <h1 className="text-center mb-12 leading-tight">
              <span className="block mb-1 font-bold uppercase tracking-widest">{parts[0].trim()}</span>
              <span className="block font-bold uppercase tracking-tight">{parts.slice(1).join(' ').trim()}</span>
            </h1>
          );
        }
      }
      return <h1 className="text-center mb-12 font-bold uppercase tracking-tight">{children}</h1>;
    },
    h2: ({ children }: any) => {
      // Force A., B., C. numbering style for top level subheaders
      return <h2 className="font-bold mb-4">{children}</h2>;
    },
    h3: ({ children }: any) => <h3 className="font-bold mb-2 italic">{children}</h3>,
    p: ({ children }: any) => <p className="text-justify leading-relaxed">{children}</p>,
    li: ({ children }: any) => <li className="text-justify">{children}</li>,
    a: ({ node, href, children, ...props }: any) => {
      if (href?.startsWith('#source-')) {
        const sourceIndexStr = href.split('-')[1];
        const sourceIndex = parseInt(sourceIndexStr, 10) - 1;
        const source = sources[sourceIndex];
        return (
          <button 
            onClick={(e) => {
              e.preventDefault();
              setViewingSource(source || { type: 'text', content: 'Source details not found.', title: `Source ${sourceIndex + 1}` });
            }}
            className="relative group inline-block cursor-help font-bold text-[#b59a6d] bg-[#b59a6d]/10 px-1.5 py-0.5 rounded mx-1 align-baseline text-[0.8em]"
          >
            <BookOpen className="w-3 h-3 inline-block mr-1 opacity-70" />
            {children}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-4 bg-[#1f2128] border border-[#2b2d35] rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all z-50 text-xs text-[#f0f1f3] pointer-events-none group-hover:pointer-events-auto text-left whitespace-normal transform scale-95 group-hover:scale-100 origin-bottom">
              <div className="font-bold border-b border-[#2b2d35] pb-2 mb-2 text-[#b59a6d] flex items-center justify-between">
                <span className="truncate pr-2">{source?.title || `Source ${sourceIndex + 1}`}</span>
              </div>
              <div className="line-clamp-4 text-[#9ca3af] leading-relaxed italic">{source?.content ? `"${source.content.substring(0, 300)}..."` : 'Content unavailable'}</div>
            </div>
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline" {...props}>{children}</a>;
    }
  };

  const processContentForUI = (text: string) => {
    return text.replace(/\s*\[SRC_(\d+)\]/g, ' [Source $1](#source-$1)');
  };

  return (
    <div className="min-h-screen bg-[#0c0d10] font-sans text-[#f0f1f3] pb-20">
      <AnimatePresence>
        {showAbout && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-[#0c0d10]/95 backdrop-blur-md" onClick={() => setShowAbout(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()} 
              className="bg-[#111318] w-full max-w-2xl p-6 sm:p-10 rounded-[2.5rem] border border-[#1f2128] shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#b59a6d]/5 blur-[100px] -translate-x-1/2 -translate-y-1/2" />
              
              <div className="relative space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#b59a6d]/10 flex items-center justify-center text-[#b59a6d]">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">{t('aboutTitle')}</h2>
                    <p className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Autonomous Research Agent v1.0</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[#9ca3af] leading-relaxed text-sm sm:text-base">
                    {t('aboutDesc')}
                  </p>
                </div>

                <div className="p-6 bg-[#16181d] rounded-2xl border border-red-500/10 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-red-400 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5" />
                    {t('disclaimerTitle')}
                  </h3>
                  <p className="text-[#64748b] text-xs leading-relaxed italic">
                    {t('disclaimerDesc')}
                  </p>
                </div>

                <div className="p-6 bg-[#b59a6d]/5 rounded-2xl border border-[#b59a6d]/10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-[#b59a6d]" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-[#b59a6d]">{t('donationTitle')}</h3>
                  </div>
                  <p className="text-[#9ca3af] text-xs leading-relaxed">
                    {t('donationDesc')}
                  </p>
                  <div className="bg-[#0c0d10] p-4 rounded-xl border border-[#1f2128] space-y-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Bank Transfer (BCA)</span>
                      <span className="text-sm font-mono text-[#f0f1f3] select-all">3771669164 a/n Aradea Wisnu</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Crypto (EVM)</span>
                      <span className="text-[10px] font-mono text-[#f0f1f3] break-all select-all">0x2A6b5204B83C7619c90c4EB6b5365AA0b7d912F7</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Crypto (Solana)</span>
                      <span className="text-[10px] font-mono text-[#f0f1f3] break-all select-all">4ZZtf84h3vTt7hVdTtq1YZZkS587WJifTrs5b9eKXmUb</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowAbout(false)} 
                  className="w-full py-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#4a4b4e] hover:text-[#f0f1f3] transition-colors border-t border-[#1f2128] pt-8"
                >
                  Close Window
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {showCoffee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-[#0c0d10]/95 backdrop-blur-md" onClick={() => setShowCoffee(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()} 
              className="bg-[#111318] w-full max-w-sm p-8 rounded-[2.5rem] border border-[#1f2128] shadow-2xl space-y-6"
            >
              <h2 className="text-xl font-bold text-[#f0f1f3]">Buy me a coffee</h2>
              <div className="bg-[#0c0d10] p-4 rounded-xl border border-[#1f2128] space-y-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Bank Transfer (BCA)</span>
                  <span className="text-sm font-mono text-[#f0f1f3] select-all">3771669164 a/n Aradea Wisnu</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Crypto (EVM)</span>
                  <span className="text-[10px] font-mono text-[#f0f1f3] break-all select-all">0x2A6b5204B83C7619c90c4EB6b5365AA0b7d912F7</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-[#4a4b4e] font-bold">Crypto (Solana)</span>
                  <span className="text-[10px] font-mono text-[#f0f1f3] break-all select-all">4ZZtf84h3vTt7hVdTtq1YZZkS587WJifTrs5b9eKXmUb</span>
                </div>
              </div>
              <button 
                  onClick={() => setShowCoffee(false)} 
                  className="w-full py-3 bg-[#b59a6d] rounded-xl text-black font-bold uppercase tracking-widest text-xs hover:bg-[#a38a60] transition-colors"
                >
                  Close
                </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <header className="bg-[#0c0d10] border-b border-[#1f2128] py-4 lg:py-6 px-4 lg:px-8 sticky top-0 z-40 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 lg:gap-6">
            <div className="flex items-center gap-2 lg:gap-3 cursor-pointer" onClick={() => { setView('generator'); setStep(1); }}>
              <img src="/ThesisAI_Logo.png?v=2" alt="ThesisAI Logo" referrerPolicy="no-referrer" className="w-12 h-12 lg:w-16 lg:h-16 rounded-2xl object-contain bg-[#16181d] p-1 border border-[#b59a6d]/20 shadow-[0_0_20px_rgba(181,154,109,0.1)]" />
              <h1 className="text-xl lg:text-3xl font-bold font-sans tracking-tight text-[#f0f1f3]">ThesisAI</h1>
            </div>
            <div className="hidden xl:block text-[10px] font-bold text-[#4a4b4e] uppercase font-mono px-3 py-1.5 border border-[#1f2128] rounded bg-[#0c0d10]">
              {t('tagline')}
            </div>
          </div>
          
          <div className="flex items-center gap-2 lg:gap-4">
            <button onClick={() => setShowAbout(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#4a4b4e] hover:text-[#b59a6d] transition mr-2">
              <Info className="w-3.5 h-3.5" />
              <span className="inline">{t('about')}</span>
            </button>
            {user && (
              <nav className="hidden md:flex items-center gap-6 mr-4 border-r border-[#1f2128] pr-4">
                <button onClick={() => setView('generator')} className={cn("text-[10px] font-bold uppercase tracking-[0.15em] transition-all", view === 'generator' ? "text-[#b59a6d]" : "text-[#4a4b4e] hover:text-[#f0f1f3]")}>{t('create')}</button>
                <button onClick={() => setView('dashboard')} className={cn("text-[10px] font-bold uppercase tracking-[0.15em] transition-all flex items-center gap-2", view === 'dashboard' ? "text-[#b59a6d]" : "text-[#4a4b4e] hover:text-[#f0f1f3]")}>
                  {t('dashboard')}
                </button>
              </nav>
            )}
            <button onClick={() => setLang(lang === 'en' ? 'id' : 'en')} className="flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-lg border border-[#1f2128] hover:bg-[#1f2128] transition text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">
              <Globe className="w-3 h-3" />
              <span className="hidden sm:inline">{lang === 'en' ? 'English' : 'Indo'}</span>
            </button>
            {!user ? (
               <button onClick={login} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#b59a6d] text-[#0c0d10] rounded-lg hover:bg-[#a38a60] transition shadow-lg shadow-[#b59a6d]/20">{t('signIn')}</button>
            ) : (
               <button onClick={logout} className="p-2 bg-[#16181d] border border-[#1f2128] rounded-xl text-[#9ca3af] hover:text-red-400 transition" title="Logout"><LogOut className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && user && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8 max-w-5xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#1f2128]">
                <div>
                  <h2 className="text-2xl lg:text-3xl font-bold text-[#f0f1f3]">{t('myLibrary')}</h2>
                  <p className="text-[#4a4b4e] text-xs mt-1 uppercase tracking-wider">{t('manageDrafts')}</p>
                </div>
                <button onClick={() => { setView('generator'); setStep(1); }} className="px-6 py-3 bg-[#b59a6d] text-[#0c0d10] font-bold uppercase tracking-[0.2em] text-[10px] rounded-xl flex items-center justify-center gap-2 hover:bg-[#a38a60] transition shadow-lg shadow-[#b59a6d]/10">
                  <Wand2 className="w-4 h-4" />
                  {t('newThesis')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                {savedTheses.map((thesis) => (
                  <motion.div key={thesis.id} className="bg-[#111318] border border-[#1f2128] rounded-2xl p-5 lg:p-6 hover:border-[#b59a6d]/50 transition group flex flex-col justify-between min-h-[160px]">
                    <div>
                      <h3 className="text-base lg:text-lg font-bold text-[#f0f1f3] line-clamp-2 mb-2 italic font-serif leading-snug group-hover:text-[#b59a6d] transition-colors">{thesis.title}</h3>
                      <div className="flex items-center gap-2 text-[10px] text-[#4a4b4e] uppercase font-mono">
                        <Clock className="w-3 h-3" />
                        {thesis.createdAt ? new Date((thesis.createdAt as any).seconds * 1000).toLocaleDateString() : 'Draft'}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#1f2128]">
                      <button onClick={() => loadThesisFromSave(thesis)} className="flex items-center gap-2 text-[#b59a6d] font-bold uppercase tracking-widest text-[10px] hover:underline">{t('openDraft')}</button>
                      <button onClick={() => deleteThesis(thesis.id!)} className="text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </motion.div>
                ))}
                {savedTheses.length === 0 && !isLoadingTheses && (
                  <div className="col-span-full py-20 text-center space-y-4 border-2 border-dashed border-[#1f2128] rounded-3xl">
                    <p className="text-[#4a4b4e] font-bold uppercase tracking-widest text-xs">{t('noSavedFound')}</p>
                    <p className="text-[#333] text-sm max-w-xs mx-auto">{t('startGenerating')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'generator' && step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 lg:space-y-12 max-w-6xl mx-auto">
              <section className="text-center space-y-4 pt-4 lg:pt-8">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="inline-block px-3 py-1 rounded-full bg-[#b59a6d]/10 border border-[#b59a6d]/20 text-[#b59a6d] text-[10px] font-bold uppercase tracking-[0.2em] mb-4">
                  Autonomous AI Research
                </motion.div>
                <h2 className="text-3xl sm:text-4xl lg:text-6xl font-black leading-tight tracking-tighter text-[#f0f1f3]">
                  {lang === 'en' ? 'Craft Your' : 'Rancang'} <br className="hidden sm:block" />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b59a6d] to-[#d4c19c]">
                    {lang === 'en' ? 'Academic Masterpiece' : 'Karya Akademik Terlengkap'}
                  </span>
                </h2>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
                <section className="bg-[#111318] rounded-[2rem] p-6 lg:p-8 border border-[#1f2128] shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#b59a6d]/5 blur-3xl rounded-full translate-x-10 -translate-y-10 group-hover:bg-[#b59a6d]/10 transition-colors" />
                  <h3 className="text-lg lg:text-xl font-bold flex items-center gap-3 text-[#f0f1f3] mb-6">
                    <div className="w-8 h-8 rounded-lg bg-[#b59a6d] text-[#0c0d10] flex items-center justify-center font-bold text-xs">1</div>
                    {t('step1Title')}
                  </h3>
                  <div className="space-y-4">
                    <div className="relative">
                      <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a4b4e]" />
                      <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="Journal / Website URL" className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl pl-11 pr-4 py-3.5 text-sm focus:border-[#b59a6d] transition-colors outline-none" />
                    </div>
                    <button onClick={addUrlSource} disabled={isFetchingUrl || !urlInput} className="bg-[#b59a6d] hover:bg-[#a38a60] text-[#0c0d10] font-black uppercase tracking-[0.2em] text-[10px] px-4 py-3.5 rounded-xl w-full transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale">
                      {isFetchingUrl ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                      {t('addUrl')}
                    </button>

                    <AnimatePresence>
                      {sources.length > 0 && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 mt-4 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                          {sources.map((s, i) => (
                            <motion.div key={i} layout className="flex items-center justify-between gap-3 text-[10px] bg-[#0c0d10] p-3 rounded-lg border border-[#1f2128] group">
                               <div className="flex items-center gap-2 min-w-0">
                                 {s.type === 'url' ? <Globe className="w-3 h-3 text-blue-400" /> : <Info className="w-3 h-3 text-[#b59a6d]" />}
                                 <span className="truncate text-[#9ca3af] font-mono">{s.title}</span>
                               </div>
                               <button onClick={() => removeSource(i)} className="text-[#4a4b4e] hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                            </motion.div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </section>

                <section className="bg-[#111318] rounded-[2rem] p-6 lg:p-8 border border-[#1f2128] shadow-2xl relative overflow-hidden flex flex-col justify-between">
                  <div className="space-y-6">
                    <h3 className="text-lg lg:text-xl font-bold flex items-center gap-3 text-[#f0f1f3]">
                      <div className="w-8 h-8 rounded-lg bg-[#b59a6d] text-[#0c0d10] flex items-center justify-center font-bold text-xs">2</div>
                      {t('configureTitle')}
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-[#4a4b4e] ml-1">{t('major')}</label>
                        <input type="text" value={config.major} onChange={e => setConfig({...config, major: e.target.value})} className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5 text-sm focus:border-[#b59a6d] outline-none transition-colors" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-[#4a4b4e] ml-1">{t('thesisLevel')}</label>
                        <select value={config.thesisLevel} onChange={e => setConfig({...config, thesisLevel: e.target.value})} className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5 text-sm focus:border-[#b59a6d] outline-none">
                          <option>Undergraduate Thesis</option>
                          <option>Master's Thesis</option>
                          <option>PhD Dissertation</option>
                  <option>Journal Paper</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-[#4a4b4e] ml-1">{t('language')}</label>
                        <select value={config.targetLanguage} onChange={e => setConfig({...config, targetLanguage: e.target.value})} className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5 text-sm focus:border-[#b59a6d] outline-none">
                          <option>English</option>
                          <option>Indonesian</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-[#4a4b4e] ml-1">{t('contentLength')}</label>
                        <select value={config.contentLength} onChange={e => setConfig({...config, contentLength: e.target.value as any})} className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5 text-sm focus:border-[#b59a6d] outline-none">
                          <option value="Short">Brief / Concise</option>
                          <option value="Standard">Standard Academic</option>
                          <option value="Comprehensive">Full/Deep Research</option>
                        </select>
                      </div>
                      <div className="space-y-2 flex flex-col justify-end">
                        <div className="flex items-center justify-between bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5">
                          <label className="text-xs font-bold text-[#f0f1f3]">{t('antiPlagiarism')}</label>
                          <button 
                            onClick={() => setConfig({...config, antiPlagiarism: !config.antiPlagiarism})}
                            className={cn(
                              "w-10 h-5 rounded-full transition-colors relative",
                              config.antiPlagiarism ? "bg-[#b59a6d]" : "bg-[#1f2128]"
                            )}
                          >
                            <motion.div 
                              animate={{ x: config.antiPlagiarism ? 22 : 2 }}
                              className="absolute top-1 left-0 w-3 h-3 bg-[#f0f1f3] rounded-full"
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-[#1f2128]">
                    <button onClick={startGeneration} disabled={isGenerating || sources.length === 0} className="w-full bg-[#b59a6d] text-[#0c0d10] font-black py-4 lg:py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl shadow-[#b59a6d]/20 disabled:opacity-50 disabled:grayscale group">
                      {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />}
                      <span className="uppercase tracking-[0.3em] text-[11px] lg:text-xs">{t('generateFull')}</span>
                    </button>
                    {sources.length === 0 && (
                      <p className="text-center text-[#4a4b4e] text-[9px] mt-4 uppercase tracking-[0.2em] font-bold pulse">
                        Waiting for Knowledge Base sources...
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {step === 2 && (
             <div className="flex flex-col items-center justify-center py-32 space-y-10 text-center">
               <div className="relative">
                 <Loader2 className="w-20 h-20 animate-spin text-[#b59a6d] opacity-20" />
                 <BookOpen className="w-8 h-8 text-[#b59a6d] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
               </div>
               <div className="space-y-2">
                 <h2 className="text-2xl font-bold text-[#f0f1f3] tracking-tight">{t('processing')}</h2>
                 <p className="text-[#4a4b4e] text-xs uppercase tracking-[0.3em] font-mono">{statusMessage || 'Synthesizing...'}</p>
                 <div className="w-48 h-1 bg-[#1f2128] rounded-full mx-auto overflow-hidden mt-4">
                   <motion.div initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} className="w-1/2 h-full bg-[#b59a6d]" />
                 </div>
               </div>
             </div>
          )}

          {step === 3 && structure && (
             <motion.div key="step3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 lg:space-y-12">
               <div className="bg-[#111318]/50 backdrop-blur-md p-6 lg:p-8 rounded-[2rem] border border-[#1f2128] max-w-5xl mx-auto shadow-2xl">
                 <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-2">
                       <h2 className="text-2xl lg:text-3xl font-serif italic text-[#f0f1f3] leading-tight">{structure.title}</h2>
                       <div className="flex items-center gap-3">
                         <span className="text-[10px] font-bold text-[#b59a6d] px-2 py-0.5 border border-[#b59a6d]/30 rounded uppercase tracking-widest">{config.thesisLevel}</span>
                         <span className="text-[10px] font-bold text-[#4a4b4e] uppercase tracking-widest font-mono">{config.major}</span>
                       </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:gap-3">
                      <button onClick={downloadDocx} className="flex-1 lg:flex-none px-4 lg:px-6 py-3 bg-[#b59a6d] text-[#0c0d10] text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-[#a38a60] transition-colors shadow-lg shadow-[#b59a6d]/10 flex items-center justify-center gap-2">
                        <Save className="w-3 h-3" /> DOCX
                      </button>
                      <button onClick={downloadPdf} className="flex-1 lg:flex-none px-4 lg:px-6 py-3 border border-[#1f2128] text-[#f0f1f3] text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-[#16181d] transition-colors flex items-center justify-center gap-2">
                        <Download className="w-3 h-3" /> PDF
                      </button>
                      <button onClick={shareThesis} className="flex-1 lg:flex-none px-4 lg:px-6 py-3 border border-[#1f2128] text-[#f0f1f3] text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-[#16181d] transition-colors flex items-center justify-center gap-2">
                        <Share className="w-3 h-3" /> Share
                      </button>
                      <button onClick={handleGenerateReferences} disabled={isGeneratingReferences || generatedThesis.length < structure.chapters.length} className="flex-1 lg:flex-none px-4 lg:px-6 py-3 border border-[#1f2128] text-[#f0f1f3] text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-[#16181d] transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                        {isGeneratingReferences ? <Loader2 className="w-3 h-3 animate-spin"/> : <BookOpen className="w-3 h-3" />} 
                        Auto References
                      </button>
                      <button onClick={() => setShowCoffee(true)} className="w-full lg:w-auto px-4 lg:px-6 py-3 border border-[#1f2128] text-[#b59a6d] text-[10px] font-black uppercase rounded-xl tracking-widest hover:border-[#b59a6d]/50 transition-colors flex items-center justify-center gap-2">
                        <Heart className="w-3 h-3" /> Buy me a coffee
                      </button>
                    </div>
                 </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 lg:gap-12">
                 <div className="hidden lg:block lg:col-span-1 sticky top-32 self-start space-y-6">
                    <div className="bg-[#111318] p-6 rounded-2xl border border-[#1f2128]">
                      <h4 className="text-[10px] font-bold text-[#4a4b4e] uppercase tracking-[0.2em] mb-6 border-b border-[#1f2128] pb-3">Table of Contents</h4>
                      <nav className="space-y-4">
                        {structure.chapters.map((ch, idx) => (
                          <div key={idx} className="flex items-start gap-4 cursor-pointer group" onClick={() => {
                            const el = document.getElementById(`chapter-${idx}`);
                            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}>
                            <span className="text-[10px] font-bold text-[#4a4b4e] mt-1 font-mono group-hover:text-[#b59a6d] transition-colors">{String(idx+1).padStart(2, '0')}</span>
                            <span className={cn("text-xs font-serif leading-relaxed transition-colors", generatedThesis[idx] ? "text-[#f0f1f3] group-hover:text-[#b59a6d]" : "text-[#4a4b4e]")}>{ch.chapter_title}</span>
                          </div>
                        ))}
                      </nav>
                    </div>
                 </div>

                 <div className="lg:col-span-3 space-y-8 lg:space-y-16 pb-[30vh]">
                    {generatedThesis.map((genCh, idx) => (
                      <div key={idx} id={`chapter-${idx}`} className="flex flex-col items-center">
                        <div className={cn(
                          "academic-paper shadow-2xl relative",
                          config.fontFamily === 'Serif' ? "academic-paper-serif" : "academic-paper-sans"
                        )}>
                           <div className="absolute top-8 right-12 text-[10px] text-gray-400 font-mono opacity-20 uppercase tracking-[0.2em]">
                             {idx === 0 ? "Thesis Final Version" : null}
                           </div>
                           <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] text-gray-400 font-serif italic tracking-widest opacity-50">
                             Page {idx + 1}
                           </div>
                           <div className="prose prose-slate max-w-none">
                             <Markdown components={markdownComponents}>{processContentForUI(genCh.content)}</Markdown>
                           </div>
                        </div>
                        {/* Page break simulation */}
                        <div className="h-4 lg:h-12 w-full flex items-center justify-center opacity-5">
                          <div className="w-1/3 h-px bg-white" />
                        </div>
                      </div>
                    ))}

                    {currentGeneratingChapter !== -1 && (
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "academic-paper shadow-2xl relative border-t-4 border-[#b59a6d]",
                          config.fontFamily === 'Serif' ? "academic-paper-serif" : "academic-paper-sans"
                        )}>
                           <div className="p-2 lg:p-10">
                             <div className="flex items-center gap-3 mb-10 text-[#b59a6d]">
                               <Loader2 className="w-5 h-5 animate-spin" />
                               <span className="text-[10px] font-black uppercase tracking-[0.3em]">{t('processing')}...</span>
                             </div>
                             <div className="prose prose-slate max-w-none opacity-40 blur-[1px] select-none">
                               <Markdown components={markdownComponents}>{processContentForUI(currentStreamedText) || "Processing neural weights..."}</Markdown>
                             </div>
                           </div>
                        </div>
                      </div>
                    )}
                 </div>
               </div>
             </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {viewingSource && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#0c0d10]/90 backdrop-blur-sm" onClick={() => setViewingSource(null)}>
            <div className="bg-[#111318] w-full max-w-2xl p-8 rounded-3xl border border-[#1f2128]">
               <h3 className="font-bold text-[#f0f1f3] mb-4">{viewingSource.title}</h3>
               <p className="text-[#9ca3af] text-sm italic">"{viewingSource.content.substring(0, 500)}..."</p>
               <button onClick={() => setViewingSource(null)} className="mt-8 px-6 py-2 bg-[#b59a6d] text-[#0c0d10] font-bold text-[10px] uppercase tracking-widest rounded">Close</button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* MiniPay & Visitor Counter Group */}
      <div className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-3">
        <div className="bg-[#111318] border border-[#1f2128] px-4 py-2 rounded-lg text-[10px] font-mono text-[#b59a6d] shadow-lg">
          {visitorCount} Visitors
        </div>
        <MiniPayAction />
      </div>

      {/* Footer */}
      <footer className="w-full py-4 text-center text-[10px] text-[#4a4b4e] font-sans tracking-widest uppercase">
          <div>Powered by @aradeawardana97</div>
          <div className="mt-1">© 2026 All Rights Reserved</div>
      </footer>
      
      {/* Interactive Chat Assistant */}
      <ChatAssistant 
        currentThesis={{ generatedThesis, structure }} 
        sources={sources} 
        config={config} 
      />
    </div>
  );
}
