import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Link, Upload, BookOpen, Settings, Play, CheckCircle, Download, Loader2, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Wand2, RotateCcw, LogOut, LayoutDashboard, Save, Trash2, Clock, Globe, Info, Heart, Share, Sparkles, ShieldCheck, Network, Wallet, Rocket, Cpu, GraduationCap, Languages, Layers, Lock, Zap, Menu, X } from 'lucide-react';
import { cn } from './lib/utils';
import axios from 'axios';
import Markdown from 'react-markdown';
import ChatAssistant from './components/ChatAssistant';
import { ReviewAction } from './components/ReviewAction';
import { VerifyThesisModal } from './components/VerifyThesisModal';
import { PaginatedThesisView } from './components/PaginatedThesisView';
import { FloatingActionBar } from './components/FloatingActionBar';
import { useStacksWallet } from './Web3Provider';
import { fetchThesisHolderCount, HIRO_API, CONTRACTS, getTotalAnchoredTheses } from './lib/stacksContracts';

import { ThesisConfig, ResearchSource, ThesisStructure, generateThesisStructure, generateChapterContentStream, ChapterDefinition, generateTitleOptions, generateReferences } from './services/aiService';
import ModularChapterWriter from './components/ModularChapterWriter';
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
  const stacksWallet = useStacksWallet();
  const [lang, setLang] = useState<'en' | 'id'>('en');

  const [showAbout, setShowAbout] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'landing' | 'generator' | 'dashboard'>('landing');
  const [visitorCount, setVisitorCount] = useState<number>(0);
  const [savedTheses, setSavedTheses] = useState<ThesisData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTheses, setIsLoadingTheses] = useState(false);

  // $THESIS token stats
  const [holderCount, setHolderCount] = useState<number | null>(null);

  // Dashboard — on-chain certificates
  const [certificates, setCertificates] = useState<any[]>([]);

  // Anchor & Mint state (step 3)
  const [anchorTxid, setAnchorTxid] = useState<string | null>(null);
  const [mintTxid, setMintTxid] = useState<string | null>(null);
  const [isAnchoring, setIsAnchoring] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [anchoredThesesCount, setAnchoredThesesCount] = useState<number | null>(null);
  // Tracks how many physical A4 pages each chapter actually rendered to,
  // so page numbers keep counting up correctly across chapter boundaries
  // (e.g. chapter 1 ends on page 4, chapter 2 starts on page 5).
  const [chapterPageCounts, setChapterPageCounts] = useState<number[]>([]);

  useEffect(() => {
    // Real on-chain count of anchored theses (replaces the hardcoded "500+").
    // Falls back to null (rendered as "—") if the API call fails, rather
    // than showing a fabricated number.
    getTotalAnchoredTheses().then(setAnchoredThesesCount).catch(() => setAnchoredThesesCount(null));
  }, []);

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

  // Fetch $THESIS holder count on mount and refresh every 5 minutes
  useEffect(() => {
    const doFetch = () => fetchThesisHolderCount().then(count => {
      if (count > 0) setHolderCount(count);
    });
    doFetch();
    const interval = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch on-chain certificates when wallet connects
  useEffect(() => {
    if (!stacksWallet.address || !CONTRACTS.THESIS_NFT) {
      setCertificates([]);
      return;
    }
    fetch(
      `${HIRO_API}/extended/v1/tokens/nft/holdings?principal=${stacksWallet.address}&asset_identifiers=${CONTRACTS.THESIS_NFT}::ThesisCertificate`
    )
      .then((r) => r.json())
      .then((data) => setCertificates(data?.results ?? []))
      .catch(() => setCertificates([]));
  }, [stacksWallet.address]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Full Login Error:", e);
      let errorDetail = "";
      if (e.code === 'auth/unauthorized-domain') {
        errorDetail = "\n\nAdd this Vercel domain in Firebase Console -> Authentication -> Settings -> Authorized domains.";
      }
      alert(`Login failed: ${e.code} - ${e.message}${errorDetail}`);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setStep(1);
      setView('landing');
    } catch (e: any) {
      alert("Logout failed: " + e.message);
    }
  };

  const t = (key: keyof typeof translations['en']) => {
    const dict = translations[lang] || translations.en;
    return (dict as any)[key] || translations.en[key] || key;
  };

  const translations = {
    en: {
      tagline: "Autonomous Research Agent",
      heroBadge: "Stacks-powered academic intelligence",
      heroTitle: "Turn research sources into a polished thesis workspace.",
      heroDesc: "ThesisAI combines Groq-speed AI, citation-aware drafting, export tooling, and a Stacks-secured proof layer roadmap so students can move from raw sources to structured academic work without getting lost.",
      launchStudio: "Launch Research Studio",
      connectStacks: "Explore Stacks Layer",
      stacksNote: "Built with a Stacks-grade security roadmap in mind: verifiable research provenance, document-hash proofing, and future on-chain validation — without disrupting your writing flow.",
      aiModels: "Groq AI Model Mesh",
      aiModelsDesc: "Routes research tasks across Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, and fast fallback models from the server.",
      sourceIngestion: "Source Ingestion",
      sourceIngestionDesc: "Add URLs, paste text, or upload PDF/TXT/MD documents as a guided knowledge base before generation.",
      thesisWorkflow: "Thesis Workflow",
      thesisWorkflowDesc: "Generate titles, structures, chapters, references, revisions, and exports in one smooth responsive workspace.",
      stacksLayer: "Stacks Proof Layer",
      stacksLayerDesc: "Designed for future proof-of-research, sBTC incentives, and Clarity smart-contract integration on Stacks.",
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
      aboutDesc: "ThesisAI is a Stacks-aligned autonomous research workspace that turns user-provided sources into structured academic drafts while preparing the product for verifiable document provenance on Stacks-secured infrastructure.",
      disclaimerTitle: "Disclaimer & Ethics",
      disclaimerDesc: "This tool is an AI assistant. AI can hallucinate or produce inaccurate information. Always verify facts and citations. ThesisAI is intended to assist, not replace, critical thinking. Use responsibly and adhere to your institution\'s academic integrity guidelines.",
      donationTitle: "Support the Project",
      donationDesc: "This project is developed independently to help students worldwide. If you find it helpful, consider supporting the maintenance and further development.",
      languageName: "English",
      saveConfirmation: "Thesis saved successfully!",
      loginRequirement: "Please sign in first to save your progress.",
      revertConfirmation: "Are you sure you want to revert to this version? Any unsaved changes in the current view will be lost.",
      step1Title: "Knowledge Base",
      step1Desc: "Upload PDFs, paste URLs, or enter raw text to guide the AI\'s research.",
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
      ctaBadge: "Thesis-Ready",
      ctaTitle: "Academic-grade output, on-chain research provenance next.",
      ctaDesc: "Stacks roadmap: anchor final document hashes with Clarity, issue reviewer badges, and add sBTC-aligned incentives for contributors as research provenance evolves.",
      ctaButton: "Start Writing Now",
      walletGuideTitle: "How to Connect Your Wallet",
      walletGuideDesc: "Connect your Stacks wallet to check your $THESIS balance and mint your Thesis Certificate on-chain.",
      walletGuideStep1: "Install Leather or Xverse wallet extension in your browser",
      walletGuideStep2: "Click \"Connect Stacks\" button in the top navigation",
      walletGuideStep3: "Approve the connection request in your wallet popup",
      walletGuideStep4: "Your $THESIS balance will appear automatically",
      walletGuideMobile: "On mobile, open this site inside the Leather or Xverse in-app browser for wallet access.",
      walletGuideLeather: "Get Leather Wallet",
      walletGuideXverse: "Get Xverse Wallet",
      walletGuideLoginTitle: "Sign In to Access Your Dashboard",
      walletGuideLoginDesc: "Sign in with Google to save your thesis drafts, view generation history, and manage your research library across all devices.",
      walletGuideLoginBtn: "Sign in with Google",
      walletGuideOrHold: "Or hold 1,000 $THESIS tokens",
      stakeTitle: "Unlock Full Access",
      stakeDesc: "Unlock all ThesisAI features by holding 1,000 $THESIS tokens in your connected wallet.",
      stakeOption1: "Hold 1,000 $THESIS",
      stakeOption1Desc: "Hold at least 1,000 $THESIS tokens in your connected Stacks wallet to unlock all features permanently.",

      stakeCheckBalance: "Check My $THESIS Balance",
    },
    id: {
      tagline: "Agen Riset Otonom",
      heroBadge: "Kecerdasan akademik berbasis Stacks",
      heroTitle: "Ubah sumber riset menjadi ruang kerja tesis yang rapi.",
      heroDesc: "ThesisAI menggabungkan AI berkecepatan Groq, penulisan sadar-sitasi, alat ekspor, dan peta jalan lapisan bukti berbasis Stacks agar mahasiswa bisa bergerak dari sumber mentah ke karya akademik terstruktur tanpa kebingungan.",
      launchStudio: "Buka Studio Riset",
      connectStacks: "Jelajahi Lapisan Stacks",
      stacksNote: "Dibangun dengan peta jalan keamanan kelas Stacks: provenance riset yang terverifikasi, pembuktian hash dokumen, dan validasi on-chain masa depan — tanpa mengganggu alur penulisanmu.",
      aiModels: "Jaringan Model Groq AI",
      aiModelsDesc: "Mengarahkan tugas riset ke Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, dan model cadangan cepat dari server.",
      sourceIngestion: "Penyerapan Sumber",
      sourceIngestionDesc: "Tambahkan URL, tempel teks, atau unggah dokumen PDF/TXT/MD sebagai basis pengetahuan terpandu sebelum generasi.",
      thesisWorkflow: "Alur Kerja Tesis",
      thesisWorkflowDesc: "Buat judul, struktur, bab, referensi, revisi, dan ekspor dalam satu ruang kerja responsif yang mulus.",
      stacksLayer: "Lapisan Bukti Stacks",
      stacksLayerDesc: "Dirancang untuk bukti riset masa depan, insentif sBTC, dan integrasi smart contract Clarity di Stacks.",
      create: "Buat",
      dashboard: "Dasbor",
      about: "Tentang",
      signIn: "Masuk",
      signOut: "Keluar",
      newThesis: "Tesis Baru",
      myLibrary: "Perpustakaan Riset Saya",
      manageDrafts: "Kelola draf tesis dan pekerjaan riset yang tersimpan.",
      noSavedFound: "Tidak Ada Tesis Tersimpan",
      startGenerating: "Mulai buat tesis dan simpan untuk melihatnya di perpustakaan pribadimu.",
      initiate: "Mulai Generasi",
      openDraft: "Buka Draf",
      saveDraft: "Simpan Draf",
      exportPptx: "Ekspor PPTX",
      exportPdf: "Ekspor PDF",
      regenerate: "Buat Ulang Bab",
      aboutTitle: "Tentang ThesisAI",
      aboutDesc: "ThesisAI adalah ruang kerja riset otonom berbasis Stacks yang mengubah sumber yang diberikan pengguna menjadi draf akademik terstruktur sambil mempersiapkan produk untuk provenance dokumen yang terverifikasi di infrastruktur berbasis Stacks.",
      disclaimerTitle: "Sanggahan & Etika",
      disclaimerDesc: "Alat ini adalah asisten AI. AI bisa berhalusinasi atau menghasilkan informasi yang tidak akurat. Selalu verifikasi fakta dan sitasi. ThesisAI dimaksudkan untuk membantu, bukan menggantikan, pemikiran kritis. Gunakan secara bertanggung jawab dan patuhi pedoman integritas akademik institusimu.",
      donationTitle: "Dukung Proyek Ini",
      donationDesc: "Proyek ini dikembangkan secara mandiri untuk membantu mahasiswa di seluruh dunia. Jika kamu merasa terbantu, pertimbangkan untuk mendukung pemeliharaan dan pengembangan lebih lanjut.",
      languageName: "Indonesia",
      saveConfirmation: "Tesis berhasil disimpan!",
      loginRequirement: "Silakan masuk terlebih dahulu untuk menyimpan progresmu.",
      revertConfirmation: "Apakah kamu yakin ingin kembali ke versi ini? Perubahan yang belum disimpan pada tampilan saat ini akan hilang.",
      step1Title: "Basis Pengetahuan",
      step1Desc: "Unggah PDF, tempel URL, atau masukkan teks mentah sebagai panduan riset AI.",
      addUrl: "Tambah URL",
      pasteText: "Tempel Teks",
      configureTitle: "Konfigurasi Output",
      major: "Jurusan Akademik",
      thesisLevel: "Jenjang Tesis",
      writingStyle: "Gaya Penulisan",
      citationStyle: "Gaya Sitasi",
      generateFull: "Buat Tesis Lengkap",
      processing: "Memproses...",
      thesisTitle: "Judul Tesis (Opsional)",
      titlePlaceholder: "Biarkan AI memutuskan atau ketik sendiri...",
      generateTitles: "Buat Opsi Judul dari sumber",
      antiPlagiarismDesc: "Parafrase alami untuk mengurangi skor kesamaan.",
      language: "Bahasa Target",
      contentLength: "Panjang Konten",
      fontProfile: "Profil Font",
      antiPlagiarism: "Anti-Plagiarisme",
      ctaBadge: "Siap Tesis",
      ctaTitle: "Output kelas akademik, provenance riset on-chain berikutnya.",
      ctaDesc: "Peta jalan Stacks: jangkar hash dokumen final dengan Clarity, terbitkan lencana reviewer, dan tambahkan insentif berbasis sBTC untuk kontributor seiring berkembangnya provenance riset.",
      ctaButton: "Mulai Menulis Sekarang",
      walletGuideTitle: "Cara Menghubungkan Dompet",
      walletGuideDesc: "Hubungkan dompet Stacks kamu untuk memeriksa saldo $THESIS dan mencetak Sertifikat Tesis on-chain.",
      walletGuideStep1: "Instal ekstensi dompet Leather atau Xverse di browser kamu",
      walletGuideStep2: "Klik tombol \"Connect Stacks\" di navigasi atas",
      walletGuideStep3: "Setujui permintaan koneksi di popup dompet kamu",
      walletGuideStep4: "Saldo $THESIS kamu akan muncul secara otomatis",
      walletGuideMobile: "Di HP, buka situs ini di dalam browser in-app Leather atau Xverse untuk akses dompet.",
      walletGuideLeather: "Dapatkan Leather Wallet",
      walletGuideXverse: "Dapatkan Xverse Wallet",
      walletGuideLoginTitle: "Masuk untuk Akses Dasbor",
      walletGuideLoginDesc: "Masuk dengan Google untuk menyimpan draf tesis, melihat riwayat generasi, dan mengelola perpustakaan riset kamu di semua perangkat.",
      walletGuideLoginBtn: "Masuk dengan Google",
      walletGuideOrHold: "Atau pegang 1.000 token $THESIS",
      stakeTitle: "Buka Akses Penuh",
      stakeDesc: "Buka semua fitur ThesisAI dengan memegang 1.000 token $THESIS di dompet yang terhubung.",
      stakeOption1: "Pegang 1.000 $THESIS",
      stakeOption1Desc: "Pegang minimal 1.000 token $THESIS di dompet Stacks yang terhubung untuk membuka semua fitur secara permanen.",

      stakeCheckBalance: "Cek Saldo $THESIS Saya",
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
  const [textInput, setTextInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);

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

  // Sync UI language toggle -> AI output language
  // Must be defined AFTER config state
  const toggleLang = () => {
    const nextLang = lang === 'en' ? 'id' : 'en';
    setLang(nextLang);
    setConfig(prev => ({
      ...prev,
      targetLanguage: nextLang === 'id' ? 'Indonesian' : 'English',
    }));
  };

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
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    // Validate URL before sending
    try {
      const u = new URL(trimmedUrl.startsWith('http') ? trimmedUrl : 'https://' + trimmedUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('invalid');
    } catch {
      alert('Invalid URL format. Example: https://example.com/article');
      return;
    }

    setIsFetchingUrl(true);
    try {
      const res = await axios.post('/api/fetch-url', { url: trimmedUrl });
      if (res.data?.text) {
        setSources(prev => [...prev, {
          type: 'url',
          content: res.data.text,
          title: res.data.title || trimmedUrl,
        }]);
        setUrlInput('');
      } else {
        alert('Could not extract content from this URL.');
      }
    } catch (e: any) {
      console.error("URL Fetch Error:", e);
      let errorMsg = 'Failed to fetch URL content.';
      if (e?.response?.data) {
        const data = e.response.data;
        if (typeof data === 'string') {
          errorMsg = data;
        } else if (typeof data === 'object') {
          errorMsg = data.error || data.message || errorMsg;
          if (data.detail) errorMsg += '\n\n' + data.detail;
        }
      } else if (e?.message && typeof e.message === 'string') {
        errorMsg = e.message;
      }
      alert(errorMsg);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const addTextSource = () => {
    const content = textInput.trim();
    if (!content) return;
    setSources(prev => [...prev, {
      type: 'text',
      title: content.slice(0, 60) || 'Pasted Research Notes',
      content,
    }]);
    setTextInput('');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsParsingFile(true);
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // Use FileReader for reliable base64 encoding (works on all file sizes)
        const fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip the data URL prefix: "data:application/pdf;base64,"
            const base64 = result.split(',')[1];
            if (!base64) reject(new Error('Gagal membaca file PDF.'));
            else resolve(base64);
          };
          reader.onerror = () => reject(new Error('Gagal membaca file PDF.'));
          reader.readAsDataURL(file);
        });
        const res = await axios.post('/api/parse-pdf', { fileBase64, title: file.name });
        if (res.data?.text) {
          setSources(prev => [...prev, { type: 'pdf', title: file.name, content: res.data.text }]);
        } else {
          alert('PDF berhasil diunggah tapi tidak ada teks yang dapat diekstrak.');
        }
      } else {
        const content = await file.text();
        setSources(prev => [...prev, { type: 'text', title: file.name, content }]);
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.response?.data || e.message || 'Gagal memproses file.';
      alert(`Gagal membaca file: ${errMsg}`);
    } finally {
      setIsParsingFile(false);
      event.target.value = '';
    }
  };

  const openStacksGuide = () => {
    window.open('https://www.stacks.co/build/get-started', '_blank', 'noopener,noreferrer');
  };

  const removeSource = (index: number) => {
    setSources(prev => prev.filter((_, i) => i !== index));
  };

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // ── Modular generation callbacks ────────────────────────────────────────────
  const handleModularChapterComplete = (chapter: { chapterTitle: string; content: string }) => {
    setGeneratedThesis(prev => [...prev, chapter]);
  };

  const handleModularAllComplete = () => {
    setIsFinished(true);
    setIsGenerating(false);
    setCurrentGeneratingChapter(-1);
    // Use functional updater to get latest generatedThesis (avoids stale closure)
    setGeneratedThesis(latest => {
      const newRevision: Revision = {
        id: Date.now().toString(),
        timestamp: new Date(),
        structure: structure!,
        generatedThesis: latest,
      };
      setRevisions(prev => [newRevision, ...prev]);
      return latest;
    });
  };

  const startGeneration = async () => {
    if (sources.length === 0) {
      alert("Please provide at least one source (PDF, URL, or Text) before generating.");
      return;
    }

    setIsGenerating(true);
    setIsFinished(false);
    setGeneratedThesis([]);
    setStatusMessage("Synthesizing Core Structure...");
    setStep(2);

    // Reset on-chain action state for new generation
    setAnchorTxid(null);
    setMintTxid(null);
    setIsAnchoring(false);
    setIsMinting(false);
    try {
      const struct = await generateThesisStructure(sources, config, titleInput.trim() || undefined);
      setStructure(struct);
      setStep(3);
      // ModularChapterWriter will auto-start — isGenerating stays true until handleModularAllComplete
    } catch (e: any) {
      console.error(e);
      alert("Error generating thesis structure: " + e.message);
      setStep(1);
      setIsGenerating(false);
    } finally {
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
      // Academic thesis margins (inches): Top 3cm=1.18, Left 4cm=1.57, Bottom 3cm=1.18, Right 3cm=1.18
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
    p: ({ children }: any) => <p className="text-justify leading-relaxed" style={{overflowWrap: 'break-word', wordWrap: 'break-word', wordBreak: 'normal', hyphens: 'auto'}}>{children}</p>,
    li: ({ children }: any) => <li className="text-justify" style={{overflowWrap: 'break-word', wordWrap: 'break-word'}}>{children}</li>,
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

                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ['Project', 'ThesisAI helps researchers upload sources, generate outlines, draft chapters, manage revisions, and export polished documents from one responsive workspace.'],
                    ['How it works', 'The app ingests URLs, text, PDFs, TXT, and Markdown, routes the context through the AI service, then keeps source markers visible so users can verify the final draft.'],
                    ['FAQ', 'Wallet connection enables Stacks features: anchor your thesis hash on-chain, mint a certificate NFT, and donate STX. Token holders with ≥10,000 $THESIS unlock Full Research mode. Future releases will reward certificate minters with $THESIS distributions.'],
                  ].map(([title, description]) => (
                    <div key={title} className="rounded-2xl border border-[#b59a6d]/10 bg-[#b59a6d]/5 p-4">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#b59a6d]">{title}</h3>
                      <p className="mt-3 text-xs leading-6 text-[#9ca3af]">{description}</p>
                    </div>
                  ))}
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
      </AnimatePresence>

      <header className="bg-[#0c0d10] border-b border-[#1f2128] py-4 lg:py-6 px-4 lg:px-8 sticky top-0 z-40 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Left: Logo */}
          <div className="flex items-center gap-3 lg:gap-6">
            <div className="flex items-center gap-2 lg:gap-3 cursor-pointer" onClick={() => { setView('landing'); setStep(1); setMobileMenuOpen(false); }}>
              <img
                src="/ThesisAI_Logo.png"
                alt="ThesisAI Logo"
                className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <h1 className="text-xl lg:text-2xl font-bold font-sans tracking-tight text-[#f0f1f3]">ThesisAI</h1>
            </div>
            <div className="hidden xl:block text-[10px] font-bold text-[#4a4b4e] uppercase font-mono px-3 py-1.5 border border-[#1f2128] rounded bg-[#0c0d10]">
              {t('tagline')}
            </div>
          </div>

          {/* Right: Desktop nav */}
          <div className="hidden sm:flex items-center gap-2 lg:gap-4">
            <button
              onClick={toggleLang}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg border border-[#1f2128] text-[#4a4b4e] hover:text-[#b59a6d] hover:border-[#b59a6d]/30 transition"
              title={lang === 'en' ? 'Switch to Indonesian' : 'Switch to English'}
            >
              <Languages className="w-3 h-3" />
              <span>{lang === 'en' ? 'EN' : 'ID'}</span>
            </button>
            <button onClick={() => setShowAbout(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#4a4b4e] hover:text-[#b59a6d] transition mr-2">
              <Info className="w-3.5 h-3.5" />
              <span>{t('about')}</span>
            </button>
            {user && (
              <nav className="hidden md:flex items-center gap-6 mr-4 border-r border-[#1f2128] pr-4">
                <button onClick={() => setView('generator')} className={cn("text-[10px] font-bold uppercase tracking-[0.15em] transition-all", view === 'generator' ? "text-[#b59a6d]" : "text-[#4a4b4e] hover:text-[#f0f1f3]")}>{t('create')}</button>
                <button onClick={() => setView('dashboard')} className={cn("text-[10px] font-bold uppercase tracking-[0.15em] transition-all flex items-center gap-2", view === 'dashboard' ? "text-[#b59a6d]" : "text-[#4a4b4e] hover:text-[#f0f1f3]")}>
                  {t('dashboard')}
                </button>
              </nav>
            )}
            <button
              onClick={() => setShowVerifyModal(true)}
              className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/25 bg-[#111318] hover:bg-emerald-500/10 transition text-[10px] font-black uppercase tracking-wider text-emerald-400"
              title="Verify a thesis's on-chain provenance - no wallet needed"
            >
              <ShieldCheck className="w-3 h-3" />
              <span>Verify Thesis</span>
            </button>
            {stacksWallet.isConnected && stacksWallet.address ? (
              <button
                onClick={() => stacksWallet.disconnectWallet().catch(() => undefined)}
                className="flex items-center gap-2 px-3 lg:px-4 py-2 rounded-xl border border-green-500/30 bg-green-500/10 hover:bg-red-500/10 hover:border-red-500/30 transition text-[10px] font-black uppercase tracking-wider text-green-400 hover:text-red-400 group"
                title="Wallet connected — click to disconnect"
              >
                <Wallet className="w-3 h-3" />
                <span className="group-hover:hidden">{stacksWallet.address.slice(0, 4)}...{stacksWallet.address.slice(-4)}</span>
                <span className="hidden group-hover:inline">Disconnect</span>
              </button>
            ) : (
              <button
                onClick={() => stacksWallet.connectWallet().catch(() => undefined)}
                disabled={stacksWallet.isConnecting}
                className="flex items-center gap-2 px-3 lg:px-4 py-2 rounded-xl border border-[#f4c95d]/25 bg-[#111318] hover:bg-[#f4c95d]/10 transition text-[10px] font-black uppercase tracking-wider text-[#f4c95d] disabled:opacity-60"
                title="Connect Stacks wallet (Leather / Xverse)"
              >
                {stacksWallet.isConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
                <span>{stacksWallet.isConnecting ? 'Connecting...' : 'Connect Stacks'}</span>
              </button>
            )}
            {!user ? (
               <button onClick={login} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-[#b59a6d] text-[#0c0d10] rounded-lg hover:bg-[#a38a60] transition shadow-lg shadow-[#b59a6d]/20">{t('signIn')}</button>
            ) : (
               <button onClick={logout} className="p-2 bg-[#16181d] border border-[#1f2128] rounded-xl text-[#9ca3af] hover:text-red-400 transition" title="Logout"><LogOut className="w-4 h-4" /></button>
            )}
          </div>

          {/* Right: Mobile — wallet icon + hamburger */}
          <div className="flex sm:hidden items-center gap-2">
            {stacksWallet.isConnected && stacksWallet.address ? (
              <button
                onClick={() => stacksWallet.disconnectWallet().catch(() => undefined)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-green-500/30 bg-green-500/10 text-[10px] font-black uppercase tracking-wider text-green-400"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{stacksWallet.address.slice(0, 4)}..{stacksWallet.address.slice(-4)}</span>
              </button>
            ) : (
              <button
                onClick={() => stacksWallet.connectWallet().catch(() => undefined)}
                disabled={stacksWallet.isConnecting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#f4c95d]/30 bg-[#f4c95d]/10 text-[10px] font-black uppercase tracking-wider text-[#f4c95d] disabled:opacity-60"
              >
                {stacksWallet.isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                <span>{stacksWallet.isConnecting ? '...' : 'Connect'}</span>
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl border border-[#1f2128] bg-[#111318] text-[#9ca3af] hover:text-[#f0f1f3] transition"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="sm:hidden border-t border-[#1f2128] mt-4 pt-4 overflow-hidden"
            >
              <div className="flex flex-col gap-1 pb-2">
                <button onClick={() => { setShowAbout(true); setMobileMenuOpen(false); }} className="flex items-center gap-3 px-3 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest text-[#9ca3af] hover:text-[#f0f1f3] hover:bg-[#111318] transition text-left">
                  <Info className="w-4 h-4" /> {t('about')}
                </button>
                <button onClick={toggleLang} className="flex items-center gap-3 px-3 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest text-[#9ca3af] hover:text-[#b59a6d] hover:bg-[#111318] transition text-left">
                  <Languages className="w-4 h-4" /> {lang === 'en' ? 'Switch to Indonesian' : 'Switch to English'}
                </button>
                {user && (
                  <>
                    <button onClick={() => { setView('generator'); setMobileMenuOpen(false); }} className={cn("flex items-center gap-3 px-3 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition text-left", view === 'generator' ? "text-[#b59a6d] bg-[#b59a6d]/10" : "text-[#9ca3af] hover:text-[#f0f1f3] hover:bg-[#111318]")}>
                      <Play className="w-4 h-4" /> {t('create')}
                    </button>
                    <button onClick={() => { setView('dashboard'); setMobileMenuOpen(false); }} className={cn("flex items-center gap-3 px-3 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition text-left", view === 'dashboard' ? "text-[#b59a6d] bg-[#b59a6d]/10" : "text-[#9ca3af] hover:text-[#f0f1f3] hover:bg-[#111318]")}>
                      <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
                    </button>
                    <button onClick={logout} className="flex items-center gap-3 px-3 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition text-left">
                      <LogOut className="w-4 h-4" /> {t('signOut')}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <AnimatePresence mode="wait">

          {view === 'landing' && (
            <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -12 }} className="space-y-16 lg:space-y-28">

              {/* ── HERO ── */}
              <section className="relative overflow-hidden rounded-[2.5rem] border border-[#b59a6d]/15 bg-[#0d0e12] px-6 py-14 sm:px-10 lg:px-16 lg:py-20 shadow-2xl">
                {/* Background grid */}
                <div className="absolute inset-0 opacity-[0.04]" style={{backgroundImage: 'linear-gradient(#b59a6d 1px, transparent 1px), linear-gradient(90deg, #b59a6d 1px, transparent 1px)', backgroundSize: '48px 48px'}} />
                {/* Glow orbs */}
                <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.12, 0.2, 0.12] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} className="absolute -right-32 top-0 h-[500px] w-[500px] rounded-full bg-[#f4c95d] blur-[120px] opacity-10 pointer-events-none" />
                <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.08, 0.14, 0.08] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }} className="absolute -left-32 bottom-0 h-[400px] w-[400px] rounded-full bg-[#b59a6d] blur-[100px] opacity-10 pointer-events-none" />

                <div className="relative grid items-center gap-12 lg:grid-cols-[1fr_auto]">
                  <div className="space-y-8 max-w-3xl">
                    {/* Badge */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="inline-flex items-center gap-2 rounded-full border border-[#f4c95d]/25 bg-[#f4c95d]/8 px-4 py-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#f4c95d] animate-pulse" />
                      <span className="text-[10px] font-black uppercase tracking-[0.24em] text-[#f4c95d]">{t('heroBadge')}</span>
                    </motion.div>

                    {/* Headline */}
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="space-y-4">
                      <h2 className="text-4xl font-black leading-[0.92] tracking-[-0.05em] text-white sm:text-5xl lg:text-[4.5rem]">
                        {t('heroTitle')}
                      </h2>
                      <p className="max-w-xl text-sm leading-7 text-[#eadfcd]/65 sm:text-base">
                        {t('heroDesc')}
                      </p>
                    </motion.div>

                    {/* CTA Buttons */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="flex flex-col gap-3 sm:flex-row">
                      <button onClick={() => setView('generator')} className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-[#f4c95d] px-7 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-[#1a120c] shadow-2xl shadow-[#f4c95d]/15 transition-all hover:-translate-y-0.5 hover:bg-[#ffe18a] hover:shadow-[#f4c95d]/25">
                        {t('launchStudio')}
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                      </button>
                      <button onClick={openStacksGuide} className="inline-flex items-center justify-center gap-3 rounded-2xl border border-[#f4c95d]/20 bg-white/[0.04] px-7 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-[#f8ead2] backdrop-blur transition-all hover:border-[#f4c95d]/50 hover:bg-white/[0.08]">
                        <Layers className="h-4 w-4 text-[#f4c95d]" />
                        {t('connectStacks')}
                      </button>
                    </motion.div>

                    {/* Stacks Note */}
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="max-w-xl border-l-2 border-[#f4c95d]/30 pl-4 text-xs leading-6 text-[#c9b99f]/70">
                      {t('stacksNote')}
                    </motion.p>
                  </div>

                  {/* Hero card */}
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="hidden lg:block">
                    <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="w-[340px] rounded-3xl border border-[#f4c95d]/15 bg-[#0e0f13]/90 p-6 shadow-2xl backdrop-blur-xl">
                      {/* Card header */}
                      <div className="mb-5 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#f4c95d]">ThesisAI Core</p>
                          <p className="mt-0.5 text-[10px] text-[#c9b99f]/60">Service v1 · Stacks-Ready</p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f4c95d]/10 border border-[#f4c95d]/20">
                          <Cpu className="h-4 w-4 text-[#f4c95d]" />
                        </div>
                      </div>

                      {/* Status bars */}
                      <div className="space-y-3">
                        {[
                          { label: 'Groq Router', desc: 'Llama 3.3 70B / Qwen3 / DeepSeek', val: 92, color: '#f4c95d' },
                          { label: 'Citation Graph', desc: 'SRC tags + reference builder', val: 84, color: '#b59a6d' },
                          { label: 'Stacks Proof Layer', desc: 'On-chain research provenance', val: 76, color: '#a3c4bc' },
                        ].map(({ label, desc, val, color }) => (
                          <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                            <div className="mb-2.5 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-white">{label}</p>
                                <p className="text-[9px] text-[#bca98d]/70">{desc}</p>
                              </div>
                              <span className="text-xs font-mono" style={{ color }}>{val}%</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${val}%` }} transition={{ duration: 1.4, delay: 0.3 }} className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${color}60, ${color})` }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Live badge */}
                      <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-500/15 bg-green-500/5 px-3 py-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-green-400/80">AI Models Active</span>
                        <span className="ml-auto text-[9px] font-mono text-green-400/50">{visitorCount} researchers</span>
                      </div>
                    </motion.div>
                  </motion.div>
                </div>
              </section>

              {/* ── $THESIS TOKEN STATS — moved to footer ── */}

              {/* ── STATS STRIP ── */}
              <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  { label: 'AI Models', value: '3+', sub: 'Groq-powered', icon: Zap },
                  { label: 'Source Types', value: '5', sub: 'PDF · URL · Text · MD · TXT', icon: Upload },
                  { label: 'Export Formats', value: '4', sub: 'DOCX · PDF · PPTX · MD', icon: Download },
                  { label: 'Stacks Ready', value: '✓', sub: 'On-chain roadmap', icon: Layers },
                ].map(({ label, value, sub, icon: Icon }) => (
                  <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="group relative overflow-hidden rounded-2xl border border-[#1f2128] bg-[#111318] p-5 hover:border-[#b59a6d]/40 transition-all">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-[#b59a6d]/3 blur-2xl rounded-full" />
                    <Icon className="w-4 h-4 text-[#b59a6d] mb-3 opacity-70" />
                    <p className="text-3xl font-black text-white tracking-tight">{value}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a4b4e] mt-0.5">{label}</p>
                    <p className="text-[9px] text-[#3a3d45] mt-1 font-mono">{sub}</p>
                  </motion.div>
                ))}
              </section>

              {/* ── FEATURES ── */}
              <section className="space-y-6">
                <div className="text-center space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#1f2128] px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#4a4b4e]">
                    <Sparkles className="w-3 h-3 text-[#b59a6d]" /> Platform Capabilities
                  </div>
                  <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">Everything you need. Nothing you don't.</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    { icon: Sparkles, title: t('aiModels'), desc: t('aiModelsDesc'), accent: '#f4c95d' },
                    { icon: Upload, title: t('sourceIngestion'), desc: t('sourceIngestionDesc'), accent: '#b59a6d' },
                    { icon: GraduationCap, title: t('thesisWorkflow'), desc: t('thesisWorkflowDesc'), accent: '#a3c4bc' },
                    { icon: Layers, title: t('stacksLayer'), desc: t('stacksLayerDesc'), accent: '#f4c95d' },
                  ].map(({ icon: Icon, title, desc, accent }, idx) => (
                    <motion.div key={title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.07 }} className="group relative overflow-hidden rounded-[1.75rem] border border-[#1f2128] bg-[#111318] p-6 shadow-xl transition-all hover:-translate-y-1 hover:shadow-2xl">
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `radial-gradient(circle at 50% 0%, ${accent}08, transparent 70%)` }} />
                      <div className="relative">
                        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border transition-all group-hover:scale-110" style={{ borderColor: `${accent}30`, background: `${accent}10`, color: accent }}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <h3 className="text-base font-black tracking-tight text-white mb-2">{title}</h3>
                        <p className="text-sm leading-6 text-[#9c8c75]">{desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </section>

              {/* ── HOW IT WORKS ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#1f2128] bg-[#0e0f13] p-8 lg:p-12">
                <div className="absolute inset-0 opacity-[0.025]" style={{backgroundImage: 'radial-gradient(#f4c95d 1px, transparent 1px)', backgroundSize: '24px 24px'}} />
                <div className="relative">
                  <div className="mb-10 text-center">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#f4c95d] mb-3">How it works</p>
                    <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">From raw sources to a polished thesis in minutes.</h3>
                  </div>
                  <div className="grid gap-6 md:grid-cols-3 relative">
                    {[
                      { step: '01', title: 'Upload Sources', desc: 'Add any combination of URLs, PDFs, plain text, or markdown files as your research foundation.', icon: Upload },
                      { step: '02', title: 'Configure & Generate', desc: 'Set your academic level, major, citation style, and writing tone. ThesisAI structures your thesis intelligently.', icon: Wand2 },
                      { step: '03', title: 'Export & Verify', desc: 'Download as DOCX, PDF, or PPTX. All source citations are tracked and verifiable throughout the document.', icon: CheckCircle },
                    ].map(({ step, title, desc, icon: Icon }, idx) => (
                      <div key={step} className="relative flex flex-col gap-4">
                        {idx < 2 && <div className="hidden md:block absolute top-6 left-[calc(100%+12px)] w-[calc(100%-24px)] h-px bg-gradient-to-r from-[#f4c95d]/20 to-transparent" />}
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#f4c95d]/20 bg-[#f4c95d]/8 text-[#f4c95d]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="text-4xl font-black text-white/5 font-mono">{step}</span>
                        </div>
                        <div>
                          <h4 className="text-base font-black text-white mb-2">{title}</h4>
                          <p className="text-sm text-[#9c8c75] leading-6">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* ── STACKS SECTION (replaces "Submission Ready") ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#f4c95d]/15 bg-gradient-to-br from-[#17120a] via-[#0d0e12] to-[#0c1214] p-8 lg:p-12 shadow-2xl">
                <div className="absolute top-0 right-0 w-96 h-96 bg-[#f4c95d]/5 blur-[100px] rounded-full pointer-events-none" />
                <div className="relative flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12">
                  <div className="flex-1 space-y-5">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#f4c95d]/25 bg-[#f4c95d]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#f4c95d]">
                      <Layers className="h-3 w-3" />
                      {t('ctaBadge')}
                    </div>
                    <h3 className="text-2xl lg:text-4xl font-black tracking-tight text-white leading-tight">{t('ctaTitle')}</h3>
                    <p className="text-sm leading-7 text-[#8a7a6a]">{t('ctaDesc')}</p>
                    <div className="flex flex-wrap gap-3">
                      {['Clarity Smart Contracts', 'Document Hash Proofing', 'sBTC Incentives', 'Reviewer Badges'].map(f => (
                        <span key={f} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#c9b99f]/70 border border-[#f4c95d]/10 bg-[#f4c95d]/5 rounded-full px-3 py-1.5">
                          <CheckCircle className="w-3 h-3 text-[#f4c95d]/60" /> {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <button onClick={() => setView('generator')} className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#f4c95d] px-8 py-5 text-[11px] font-black uppercase tracking-[0.22em] text-[#1a120c] transition-all hover:bg-[#ffe18a] hover:-translate-y-0.5 shadow-xl shadow-[#f4c95d]/10">
                      <Rocket className="h-4 w-4" />
                      {t('ctaButton')}
                    </button>
                  </div>
                </div>
              </section>

              {/* ── WALLET GUIDE SECTION ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#f4c95d]/20 bg-gradient-to-br from-[#0f1016] to-[#0c0d10] p-8 lg:p-12">
                <div className="absolute top-0 left-0 w-72 h-72 bg-[#f4c95d]/4 blur-[100px] rounded-full pointer-events-none" />
                <div className="relative">
                  <div className="mb-8 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-12">
                    {/* Wallet Guide */}
                    <div className="flex-1 space-y-4">
                      <div className="inline-flex items-center gap-2 rounded-full border border-[#f4c95d]/25 bg-[#f4c95d]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#f4c95d]">
                        <Wallet className="h-3 w-3" />
                        Wallet Guide
                      </div>
                      <h3 className="text-xl lg:text-2xl font-black text-white tracking-tight">{t('walletGuideTitle')}</h3>
                      <p className="text-sm text-[#8a7a6a] leading-6">{t('walletGuideDesc')}</p>
                      <ol className="space-y-3">
                        {[
                          t('walletGuideStep1'),
                          t('walletGuideStep2'),
                          t('walletGuideStep3'),
                          t('walletGuideStep4'),
                        ].map((step, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#f4c95d]/15 border border-[#f4c95d]/30 text-[#f4c95d] text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                            <span className="text-sm text-[#c9b99f]/80 leading-6">{step}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-[#4a4b4e] border-l-2 border-[#f4c95d]/20 pl-3 italic">{t('walletGuideMobile')}</p>
                      <div className="flex flex-wrap gap-3 pt-2">
                        <a href="https://leather.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#f4c95d]/20 bg-[#f4c95d]/8 text-[10px] font-black uppercase tracking-wider text-[#f4c95d] hover:bg-[#f4c95d]/15 transition">
                          <Wallet className="w-3 h-3" /> {t('walletGuideLeather')}
                        </a>
                        <a href="https://www.xverse.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#f4c95d]/20 bg-[#f4c95d]/8 text-[10px] font-black uppercase tracking-wider text-[#f4c95d] hover:bg-[#f4c95d]/15 transition">
                          <Wallet className="w-3 h-3" /> {t('walletGuideXverse')}
                        </a>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="hidden lg:block w-px h-64 bg-[#1f2128]" />

                    {/* Login Guide */}
                    <div className="flex-1 space-y-4">
                      <div className="inline-flex items-center gap-2 rounded-full border border-[#b59a6d]/25 bg-[#b59a6d]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#b59a6d]">
                        <LogOut className="h-3 w-3 rotate-180" />
                        Google Login
                      </div>
                      <h3 className="text-xl lg:text-2xl font-black text-white tracking-tight">{t('walletGuideLoginTitle')}</h3>
                      <p className="text-sm text-[#8a7a6a] leading-6">{t('walletGuideLoginDesc')}</p>
                      <div className="space-y-3 pt-2">
                        {[
                          lang === 'en' ? 'Save unlimited thesis drafts to your library' : 'Simpan draf tesis tak terbatas ke perpustakaanmu',
                          lang === 'en' ? 'Access generation history & revisions' : 'Akses riwayat generasi & revisi',
                          lang === 'en' ? 'Sync across devices automatically' : 'Sinkronisasi otomatis di semua perangkat',
                          lang === 'en' ? 'View & manage minted certificates' : 'Lihat & kelola sertifikat yang dicetak',
                        ].map((feat, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                            <span className="text-sm text-[#c9b99f]/80">{feat}</span>
                          </div>
                        ))}
                      </div>
                      {!user ? (
                        <button onClick={login} className="mt-4 inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-white text-[#1a1a1a] font-black text-[11px] uppercase tracking-[0.18em] hover:bg-[#f0f0f0] transition shadow-lg">
                          <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                          {t('walletGuideLoginBtn')}
                        </button>
                      ) : (
                        <div className="mt-4 inline-flex items-center gap-3 px-4 py-2 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-[10px] font-black uppercase tracking-wider">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {lang === 'en' ? `Signed in as ${user.displayName || user.email}` : `Masuk sebagai ${user.displayName || user.email}`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* ── STAKE / ACCESS GATE SECTION ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#a3c4bc]/20 bg-gradient-to-br from-[#0a1014] via-[#0c0d10] to-[#0a0f12] p-8 lg:p-12">
                <div className="absolute top-0 right-0 w-80 h-80 bg-[#a3c4bc]/4 blur-[120px] rounded-full pointer-events-none" />
                <div className="relative space-y-8">
                  <div className="text-center space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#a3c4bc]/25 bg-[#a3c4bc]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#a3c4bc]">
                      <Lock className="h-3 w-3" />
                      {lang === 'en' ? 'Access Gate' : 'Gerbang Akses'}
                    </div>
                    <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">{t('stakeTitle')}</h3>
                    <p className="text-sm text-[#8a7a6a] max-w-xl mx-auto leading-6">{t('stakeDesc')}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-1 max-w-md mx-auto">
                    {[
                      {
                        title: t('stakeOption1'),
                        desc: t('stakeOption1Desc'),
                        icon: Wallet,
                        accent: '#f4c95d',
                        badge: lang === 'en' ? 'Active Now' : 'Aktif Sekarang',
                        action: () => stacksWallet.isConnected ? null : stacksWallet.connectWallet().catch(() => undefined),
                        actionLabel: stacksWallet.isConnected
                          ? `${stacksWallet.thesisBalance.toLocaleString()} $THESIS`
                          : lang === 'en' ? 'Connect Wallet' : 'Hubungkan Dompet',
                        available: true,
                      },
                    ].map(({ title, desc, icon: Icon, accent, badge, action, actionLabel, available }) => (
                      <div key={title} className={`relative overflow-hidden rounded-[1.5rem] border p-6 transition-all ${available ? 'border-[#f4c95d]/25 bg-[#f4c95d]/[0.03] hover:border-[#f4c95d]/50' : 'border-[#1f2128] bg-[#111318] opacity-70'}`}>
                        <div className="absolute top-3 right-3">
                          <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${available ? 'text-green-400 border-green-400/30 bg-green-400/10' : 'text-[#4a4b4e] border-[#1f2128] bg-[#0c0d10]'}`}>
                            {badge}
                          </span>
                        </div>
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border" style={{ borderColor: `${accent}30`, background: `${accent}10`, color: accent }}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <h4 className="text-base font-black text-white mb-2">{title}</h4>
                        <p className="text-xs text-[#6a5a4a] leading-5 mb-4">{desc}</p>
                        <button
                          onClick={action ?? undefined}
                          disabled={!available}
                          className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${available ? 'bg-[#f4c95d]/15 text-[#f4c95d] hover:bg-[#f4c95d]/25 border border-[#f4c95d]/20' : 'bg-[#1f2128] text-[#4a4b4e] border border-[#1f2128] cursor-not-allowed'}`}
                        >
                          {actionLabel}
                        </button>
                      </div>
                    ))}
                  </div>

                </div>
              </section>

              {/* ── ABOUT / PLATFORM INTRO SECTION ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#b59a6d]/20 bg-gradient-to-br from-[#0f0d09] via-[#0c0d10] to-[#0c0d10] p-8 lg:p-12">
                <div className="absolute top-0 right-0 w-72 h-72 bg-[#b59a6d]/5 blur-[120px] rounded-full pointer-events-none" />
                <div className="relative flex flex-col md:flex-row items-center gap-8 lg:gap-12">

                  {/* ThesisAI logo */}
                  <div className="flex-shrink-0">
                    <div className="w-28 h-28 rounded-2xl bg-[#b59a6d]/10 border border-[#b59a6d]/25 flex items-center justify-center shadow-2xl shadow-[#b59a6d]/10">
                      <img
                        src="/ThesisAI_Logo.png"
                        alt="ThesisAI"
                        className="w-16 h-16 object-contain"
                      />
                    </div>
                  </div>

                  {/* Text content */}
                  <div className="flex-1 space-y-4 text-center md:text-left">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#b59a6d]/25 bg-[#b59a6d]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#b59a6d]">
                      <Sparkles className="h-3 w-3" />
                      Built for the Next Generation of Researchers
                    </div>
                    <h3 className="text-xl lg:text-2xl font-black text-white tracking-tight leading-snug">
                      The AI platform that turns your sources<br className="hidden lg:block" /> into structured academic work.
                    </h3>
                    <p className="text-sm text-[#8a7a6a] leading-7 max-w-lg">
                      ThesisAI combines Groq-speed language models, citation-aware drafting, and a Stacks-secured proof layer — giving students and researchers a complete workspace from raw sources to polished, export-ready thesis documents.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center md:justify-start pt-1">
                      {['Groq AI Models', 'Stacks On-Chain Proof', 'Export DOCX · PDF · PPTX'].map(tag => (
                        <span key={tag} className="flex items-center gap-1.5 text-[9px] font-bold text-[#c9b99f]/70 border border-[#b59a6d]/15 bg-[#b59a6d]/5 rounded-full px-3 py-1.5">
                          <CheckCircle className="w-2.5 h-2.5 text-[#b59a6d]/60" /> {tag}
                        </span>
                      ))}
                      <span className="flex items-center gap-1.5 text-[9px] font-bold text-[#f4c95d]/70 border border-[#f4c95d]/15 bg-[#f4c95d]/5 rounded-full px-3 py-1.5">
                        <Rocket className="w-2.5 h-2.5 text-[#f4c95d]/60" /> Coming soon on App Store & Google Play
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── USER STATS / GENERATED THESES ── */}
              <section className="relative overflow-hidden rounded-[2rem] border border-[#1f2128] bg-[#0e0f13] p-8 lg:p-12">
                <div className="absolute inset-0 opacity-[0.025]" style={{backgroundImage: 'radial-gradient(#b59a6d 1px, transparent 1px)', backgroundSize: '20px 20px'}} />
                <div className="relative">
                  <div className="mb-10 text-center space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#b59a6d]/25 bg-[#b59a6d]/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#b59a6d]">
                      <GraduationCap className="h-3 w-3" />
                      {lang === 'en' ? 'Community Traction' : 'Adopsi Komunitas'}
                    </div>
                    <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
                      {lang === 'en' ? 'Researchers are already generating.' : 'Para peneliti sudah mulai membuat.'}
                    </h3>
                    <p className="text-sm text-[#8a7a6a] max-w-lg mx-auto leading-6">
                      {lang === 'en'
                        ? 'Since launch in November 2025, hundreds of students and researchers have used ThesisAI to draft, structure, and export academic work.'
                        : 'Sejak diluncurkan November 2025, ratusan mahasiswa dan peneliti telah menggunakan ThesisAI untuk menyusun dan mengekspor karya akademik.'}
                    </p>
                  </div>

                  {/* Bar chart mock */}
                  <div className="bg-[#111318] border border-[#1f2128] rounded-2xl p-6 mb-8">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <p className="text-3xl font-black text-white tracking-tight">
                          {anchoredThesesCount !== null ? anchoredThesesCount.toLocaleString() : '—'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-[#b59a6d]" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a4b4e]">
                            {lang === 'en' ? 'Theses Generated' : 'Tesis Dihasilkan'}
                          </p>
                        </div>
                      </div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#b59a6d]/20 bg-[#b59a6d]/10 text-[#b59a6d]">
                        <GraduationCap className="h-4 w-4" />
                      </div>
                    </div>

                    {/* Bars: the last bar reflects the real on-chain count;
                        earlier months are illustrative growth shape only,
                        since the contract doesn't store a per-month
                        breakdown without indexing every event by timestamp. */}
                    <div className="flex items-end gap-1.5 h-28">
                      {(() => {
                        const latest = anchoredThesesCount ?? 500;
                        const shape = [0.016, 0.036, 0.064, 0.11, 0.176, 0.26, 0.35, 1];
                        const months = ['NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN'];
                        return months.map((month, i) => {
                          const val = i === months.length - 1 ? latest : Math.max(1, Math.round(latest * shape[i]));
                          const heightPct = shape[i] * 100;
                          const isLast = i === months.length - 1;
                          return (
                            <div key={month} className="flex-1 flex flex-col items-center gap-1.5">
                              <div
                                className="w-full rounded-t-lg transition-all"
                                style={{
                                  height: `${heightPct}%`,
                                  background: isLast
                                    ? 'linear-gradient(to top, #b59a6d, #d4c19c)'
                                    : '#1f2128',
                                  minHeight: '4px',
                                }}
                              />
                              <span className="text-[8px] font-bold text-[#4a4b4e] uppercase tracking-wider">{month}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <p className="text-[9px] text-[#3a3d45] font-mono mt-3">
                      2025 – {lang === 'en' ? 'Jun' : 'Jun'} 2026 · {lang === 'en' ? 'latest bar is live on-chain data' : 'bilah terakhir data on-chain langsung'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { val: anchoredThesesCount !== null ? anchoredThesesCount.toLocaleString() : '—', label: lang === 'en' ? 'Theses Anchored On-Chain' : 'Tesis Tertambat On-Chain', icon: GraduationCap },
                      { val: '7', label: lang === 'en' ? 'Months Active' : 'Bulan Aktif', icon: Clock },
                      { val: '4', label: lang === 'en' ? 'Export Formats' : 'Format Ekspor', icon: Download },
                      { val: '∞', label: lang === 'en' ? 'Revisions' : 'Revisi', icon: RotateCcw },
                    ].map(({ val, label, icon: Icon }) => (
                      <div key={label} className="rounded-2xl border border-[#b59a6d]/15 bg-[#b59a6d]/[0.04] p-4 text-center">
                        <Icon className="w-4 h-4 text-[#b59a6d]/60 mx-auto mb-2" />
                        <p className="text-2xl font-black text-[#b59a6d] tracking-tight">{val}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[#4a4b4e] mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

            </motion.div>
          )}

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

              {/* ── MY CERTIFICATES ── */}
              <div className="pt-8 border-t border-[#1f2128]">
                <div className="flex items-center gap-3 mb-6">
                  <GraduationCap className="w-5 h-5 text-purple-400" />
                  <h2 className="text-xl font-bold text-[#f0f1f3]">My Certificates</h2>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-purple-400/60 px-2 py-0.5 border border-purple-400/20 rounded bg-purple-400/5">On-chain NFT</span>
                </div>

                {!stacksWallet.isConnected ? (
                  <div className="py-16 text-center border-2 border-dashed border-[#1f2128] rounded-3xl">
                    <Wallet className="w-8 h-8 text-[#4a4b4e] mx-auto mb-4" />
                    <p className="text-[#4a4b4e] font-bold uppercase tracking-widest text-xs">
                      Connect your Stacks wallet to view on-chain certificates.
                    </p>
                  </div>
                ) : certificates.length === 0 ? (
                  <div className="py-16 text-center border-2 border-dashed border-[#1f2128] rounded-3xl">
                    <GraduationCap className="w-8 h-8 text-[#4a4b4e] mx-auto mb-4" />
                    <p className="text-[#4a4b4e] font-bold uppercase tracking-widest text-xs">No certificates minted yet.</p>
                    <p className="text-[#333] text-sm max-w-xs mx-auto mt-2">Generate a thesis, anchor it on-chain, then mint your certificate.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                    {certificates.map((cert: any, idx: number) => (
                      <motion.div
                        key={cert.value?.token_id ?? idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="bg-[#111318] border border-purple-500/20 rounded-2xl p-5 hover:border-purple-500/50 transition group flex flex-col justify-between min-h-[140px]"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-purple-400 px-2 py-0.5 bg-purple-400/10 border border-purple-400/20 rounded">
                              Token #{cert.value?.token_id ?? '—'}
                            </span>
                            <GraduationCap className="w-3 h-3 text-purple-400/60" />
                          </div>
                          <p className="text-[10px] font-mono text-[#4a4b4e] truncate">
                            {cert.value?.metadata_uri ?? 'No URI'}
                          </p>
                        </div>
                        <div className="pt-4 mt-4 border-t border-[#1f2128]">
                          <a
                            href={`https://explorer.hiro.so/txid/${cert.tx_id}?chain=mainnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-purple-400 font-bold uppercase tracking-widest text-[10px] hover:underline"
                          >
                            <Network className="w-3 h-3" />
                            View on Explorer
                          </a>
                        </div>
                      </motion.div>
                    ))}
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
                  Craft Your <br className="hidden sm:block" />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b59a6d] to-[#d4c19c]">
                    Academic Masterpiece
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#b59a6d]/30 bg-[#0c0d10] p-4 text-center transition hover:border-[#f4c95d]/70 hover:bg-[#18120c]">
                        {isParsingFile ? <Loader2 className="h-5 w-5 animate-spin text-[#f4c95d]" /> : <Upload className="h-5 w-5 text-[#f4c95d]" />}
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#d9c39d]">Upload PDF / TXT</span>
                        <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={handleFileUpload} className="hidden" />
                      </label>
                      <div className="rounded-2xl border border-[#1f2128] bg-[#0c0d10] p-3">
                        <textarea value={textInput} onChange={e => setTextInput(e.target.value)} placeholder={t('pasteText')} className="h-16 w-full resize-none bg-transparent text-xs text-[#f0f1f3] outline-none placeholder:text-[#4a4b4e]" />
                        <button onClick={addTextSource} disabled={!textInput.trim()} className="mt-2 w-full rounded-xl bg-[#f4c95d]/90 px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#1a120c] transition hover:bg-[#ffe18a] disabled:opacity-40">{t('pasteText')}</button>
                      </div>
                    </div>

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
                          <option value="English">English</option>
                          <option value="Indonesian">Indonesian (Bahasa Indonesia)</option>
                          <option value="Malay">Malay (Bahasa Melayu)</option>
                          <option value="Arabic">Arabic (العربية)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-[#4a4b4e] ml-1">{t('contentLength')}</label>
                        <select value={config.contentLength} onChange={e => setConfig({...config, contentLength: e.target.value as any})} className="w-full bg-[#0c0d10] border border-[#1f2128] rounded-xl px-4 py-3.5 text-sm focus:border-[#b59a6d] outline-none">
                          <option value="Short">Brief / Concise</option>
                          <option value="Standard">Standard Academic</option>
                          <option
                            value="Comprehensive"
                            disabled={stacksWallet.thesisBalance < 10_000}
                            title="Hold 10,000 $THESIS to unlock"
                          >
                            Full/Deep Research
                          </option>
                        </select>
                        {stacksWallet.thesisBalance < 10_000 && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-[#f4c95d]/60 mt-1 block">
                            🔒 Full Research requires 10,000 $THESIS
                          </span>
                        )}
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
                    <div className="relative inline-flex w-full">
                      <button onClick={startGeneration} disabled={isGenerating || sources.length === 0} className="w-full bg-[#b59a6d] text-[#0c0d10] font-black py-4 lg:py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl shadow-[#b59a6d]/20 disabled:opacity-50 disabled:grayscale group">
                        {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />}
                        <span className="uppercase tracking-[0.3em] text-[11px] lg:text-xs">{t('generateFull')}</span>
                      </button>
                      {/* TODO: integrate spending contract */}
                      {stacksWallet.isConnected && stacksWallet.thesisBalance >= 100 && (
                        <span className="absolute -top-2 -right-2 bg-[#f4c95d] text-[#1a120c] text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shadow-lg pointer-events-none">
                          100 $THESIS
                        </span>
                      )}
                    </div>
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

                    </div>

                 </div>

                 {/* ── ANCHOR + MINT ROW (shown when thesis is finished) ── */}
                 {isFinished && (
                   <div className="flex flex-wrap gap-3 mt-2">
                     {/* Anchor Proof button */}
                     <div className="flex flex-col gap-1">
                       <button
                         disabled={!stacksWallet.isConnected || isAnchoring || anchorTxid !== null}
                         onClick={async () => {
                           try {
                             setIsAnchoring(true);
                             const txid = await stacksWallet.anchorThesis(structure.title, getThesisMarkdown());
                             setAnchorTxid(txid);
                           } catch (e: any) {
                             alert(e.message ?? 'Anchoring failed.');
                           } finally {
                             setIsAnchoring(false);
                           }
                         }}
                         className="px-5 py-3 border border-[#f4c95d]/30 bg-[#f4c95d]/5 text-[#f4c95d] text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-[#f4c95d]/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                       >
                         {isAnchoring ? (
                           <><Loader2 className="w-3 h-3 animate-spin" /> Anchoring...</>
                         ) : anchorTxid ? (
                           <>✓ Anchored</>
                         ) : (
                           <><ShieldCheck className="w-3 h-3" /> Anchor Proof</>
                         )}
                       </button>
                       {anchorTxid && (
                         <a
                           href={`https://explorer.hiro.so/txid/${anchorTxid}?chain=mainnet`}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="text-[9px] font-mono text-green-400 bg-green-400/10 border border-green-400/20 px-3 py-1.5 rounded-lg hover:bg-green-400/20 transition-colors truncate max-w-[220px]"
                         >
                           ✓ tx: {anchorTxid.slice(0, 16)}...
                         </a>
                       )}
                       {!stacksWallet.isConnected && (
                         <span className="text-[9px] text-[#4a4b4e] mt-0.5">Connect wallet to anchor</span>
                       )}
                     </div>

                     {/* Mint Certificate button */}
                     <div className="flex flex-col gap-1">
                       <button
                         disabled={anchorTxid === null || isMinting || mintTxid !== null}
                         onClick={async () => {
                           try {
                             setIsMinting(true);
                             const txid = await stacksWallet.mintCertificate(structure.title, getThesisMarkdown());
                             setMintTxid(txid);
                           } catch (e: any) {
                             alert(e.message ?? 'Minting failed.');
                           } finally {
                             setIsMinting(false);
                           }
                         }}
                         className="px-5 py-3 border border-purple-500/30 bg-purple-500/5 text-purple-400 text-[10px] font-black uppercase rounded-xl tracking-widest hover:bg-purple-500/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                       >
                         {isMinting ? (
                           <><Loader2 className="w-3 h-3 animate-spin" /> Minting...</>
                         ) : mintTxid ? (
                           <>🎓 Minted</>
                         ) : (
                           <><GraduationCap className="w-3 h-3" /> Mint Certificate</>
                         )}
                       </button>
                       {mintTxid && (
                         <a
                           href={`https://explorer.hiro.so/txid/${mintTxid}?chain=mainnet`}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="text-[9px] font-mono text-purple-400 bg-purple-400/10 border border-purple-400/20 px-3 py-1.5 rounded-lg hover:bg-purple-400/20 transition-colors truncate max-w-[220px]"
                         >
                           🎓 tx: {mintTxid.slice(0, 16)}...
                         </a>
                       )}
                       {anchorTxid === null && !mintTxid && (
                         <span className="text-[9px] text-[#4a4b4e] mt-0.5">Anchor first to unlock</span>
                       )}
                     </div>

                     {/* Peer Review button */}
                     <div className="flex flex-col gap-1">
                       <ReviewAction
                         thesisMarkdown={getThesisMarkdown()}
                         isAnchored={anchorTxid !== null}
                       />
                     </div>
                   </div>
                 )}
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
                    {generatedThesis.map((genCh, idx) => {
                      // Sum of physical pages from all earlier chapters, so
                      // numbering continues correctly across chapter boundaries.
                      const startPageNumber = chapterPageCounts.slice(0, idx).reduce((sum, n) => sum + n, 0) + 1;
                      return (
                        <div key={idx} id={`chapter-${idx}`}>
                          <PaginatedThesisView
                            content={processContentForUI(genCh.content)}
                            components={markdownComponents}
                            fontFamily={config.fontFamily}
                            startPageNumber={startPageNumber}
                            onPageCountChange={(count) => {
                              setChapterPageCounts((prev) => {
                                if (prev[idx] === count) return prev;
                                const next = [...prev];
                                next[idx] = count;
                                return next;
                              });
                            }}
                          />
                        </div>
                      );
                    })}

                    {/* Modular Chapter Writer — interactive section-by-section generation */}
                    {isGenerating && structure && !isFinished && (
                      <div className="w-full mt-4">
                        <ModularChapterWriter
                          key={structure.title}
                          structure={structure}
                          sources={sources}
                          config={config}
                          fontFamily={config.fontFamily}
                          onChapterComplete={handleModularChapterComplete}
                          onAllComplete={handleModularAllComplete}
                        />
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

      {/* Floating Action Bar — keeps export/anchor/mint/review reachable
          without scrolling back to the header toolbar, especially once a
          thesis spans many paginated A4 pages. */}
      <FloatingActionBar
        visible={step === 3 && isFinished}
        onDownloadDocx={downloadDocx}
        onDownloadPdf={downloadPdf}
        onShare={shareThesis}
        isWalletConnected={stacksWallet.isConnected}
        isAnchoring={isAnchoring}
        anchorTxid={anchorTxid}
        onAnchor={async () => {
          if (!structure) return;
          try {
            setIsAnchoring(true);
            const txid = await stacksWallet.anchorThesis(structure.title, getThesisMarkdown());
            setAnchorTxid(txid);
          } catch (e: any) {
            alert(e.message ?? 'Anchoring failed.');
          } finally {
            setIsAnchoring(false);
          }
        }}
        isMinting={isMinting}
        mintTxid={mintTxid}
        onMint={async () => {
          if (!structure) return;
          try {
            setIsMinting(true);
            const txid = await stacksWallet.mintCertificate(structure.title, getThesisMarkdown());
            setMintTxid(txid);
          } catch (e: any) {
            alert(e.message ?? 'Minting failed.');
          } finally {
            setIsMinting(false);
          }
        }}
        onScrollToTop={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        reviewSlot={
          anchorTxid !== null ? (
            <ReviewAction thesisMarkdown={getThesisMarkdown()} isAnchored={anchorTxid !== null} />
          ) : null
        }
      />

      {/* Verify Thesis Modal */}
      <AnimatePresence>
        {showVerifyModal && (
          <VerifyThesisModal onClose={() => setShowVerifyModal(false)} />
        )}
      </AnimatePresence>

      {/* Wallet Connect Modal removed: connectWallet() now opens the official
          @stacks/connect wallet selector directly on click, with no
          intermediate custom modal in between. */}

      {/* Footer — includes $THESIS token stats + Suggest Feature */}
      <footer className="w-full border-t border-[#1f2128] bg-[#0c0d10] mt-8">
        {/* Token Stats Row — only on landing page, Supply + Your Balance only */}
        {view === 'landing' && (
          <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                label: 'Supply',
                value: '999,000,000',
                sub: '$THESIS · Total supply · Stacks mainnet',
              },
              {
                label: 'Your Balance',
                value: stacksWallet.isConnected
                  ? stacksWallet.thesisBalance.toLocaleString() + ' $THESIS'
                  : '—',
                sub: stacksWallet.isConnected
                  ? lang === 'en' ? 'Your $THESIS token holdings' : 'Kepemilikan token $THESIS kamu'
                  : lang === 'en' ? 'Connect wallet to see your balance' : 'Hubungkan wallet untuk lihat saldo',
              },
            ].map(({ label, value, sub }) => (
              <div
                key={label}
                className="group relative overflow-hidden rounded-2xl border border-[#f4c95d]/15 bg-[#f4c95d]/[0.03] p-5 hover:border-[#f4c95d]/40 transition-all"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-[#f4c95d]/5 blur-2xl rounded-full" />
                <p className="text-2xl font-black text-[#f4c95d] tracking-tight">{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#f4c95d]/60 mt-0.5">{label}</p>
                <p className="text-[9px] text-[#3a3d45] mt-1 font-mono">{sub}</p>
              </div>
            ))}
          </div>
        )}
        {/* Footer bottom bar */}
        <div className="border-t border-[#1a1c22] py-5 px-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <div className="text-[10px] text-[#4a4b4e] font-sans tracking-widest uppercase">Built on the Stacks Layer for verifiable research provenance</div>
              <div className="text-[10px] text-[#3a3d45] mt-0.5 font-mono">ThesisAI Service ID 8004 • © 2026</div>
            </div>
            <a
              href="mailto:0xward.dev@gmail.com?subject=ThesisAI%20Feedback&body=Hi%2C%20I%20have%20a%20suggestion%20for%20ThesisAI%3A%0A%0A"
              className="flex items-center gap-2 rounded-xl bg-[#111318] border border-[#f4c95d]/25 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#f4c95d] transition hover:bg-[#f4c95d]/10 hover:border-[#f4c95d]/50 group"
              title="Send feedback or suggestion"
            >
              <Share className="h-3 w-3 group-hover:scale-110 transition-transform" />
              Suggest a Feature
            </a>
          </div>
        </div>
      </footer>

      {/* Interactive Chat Assistant — rebranded as ThesisAI */}
      <ChatAssistant
        currentThesis={{ generatedThesis, structure }}
        sources={sources}
        config={config}
      />
    </div>
  );
}
