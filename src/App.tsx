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
import { LanguageSwitcher } from './components/LanguageSwitcher';
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
  type AppLanguage = 'en' | 'id' | 'ms' | 'ar' | 'es' | 'pt' | 'ru' | 'fr' | 'vi' | 'th' | 'hi' | 'fa' | 'ja' | 'ko' | 'ha' | 'sw';
  const [lang, setLang] = useState<AppLanguage>('en');

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
  const [showMobileDisconnect, setShowMobileDisconnect] = useState(false);
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
        resetWorkspace();
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

  useEffect(() => {
    if (!stacksWallet.isConnected) setShowMobileDisconnect(false);
  }, [stacksWallet.isConnected]);

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
      resetWorkspace();
      setStep(1);
      setView('landing');
    } catch (e: any) {
      alert("Logout failed: " + e.message);
    }
  };

  /**
   * Clears every piece of in-memory workspace state: research sources,
   * thesis structure, generated chapters, form inputs, and on-chain action
   * results (anchor/mint txids). Without this, switching accounts (or
   * switching wallets) in the same browser tab left the previous person's
   * pasted text, uploaded files, and generated thesis content visible to
   * whoever used the tab next, since React state isn't tied to Firebase
   * auth state or wallet connection state automatically.
   */
  const resetWorkspace = () => {
    setSources([]);
    setUrlInput('');
    setTextInput('');
    setTitleInput('');
    setStructure(null);
    setGeneratedThesis([]);
    setChapterPageCounts([]);
    setAnchorTxid(null);
    setMintTxid(null);
    setIsFinished(false);
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

      saveUnlimitedDrafts: "Save unlimited thesis drafts to your library",
      accessGenHistory: "Access generation history & revisions",
      syncDevices: "Sync across devices automatically",
      viewCertificates: "View & manage minted certificates",
      signedInAsPrefix: "Signed in as",
      accessGate: "Access Gate",
      activeNow: "Active Now",
      connectWalletBtn: "Connect Wallet",
      communityTraction: "Community Traction",
      researchersGenerating: "Researchers are already generating.",
      thesesGenerated: "Theses Generated",
      latestBarLive: "latest bar is live on-chain data",
      monthsActive: "Months Active",
      exportFormatsLabel: "Export Formats",
      revisionsLabel: "Revisions",
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

      saveUnlimitedDrafts: "Simpan draf tesis tak terbatas ke perpustakaanmu",
      accessGenHistory: "Akses riwayat generasi & revisi",
      syncDevices: "Sinkronisasi otomatis di semua perangkat",
      viewCertificates: "Lihat & kelola sertifikat yang dicetak",
      signedInAsPrefix: "Masuk sebagai",
      accessGate: "Gerbang Akses",
      activeNow: "Aktif Sekarang",
      connectWalletBtn: "Hubungkan Dompet",
      communityTraction: "Adopsi Komunitas",
      researchersGenerating: "Para peneliti sudah mulai membuat.",
      thesesGenerated: "Tesis Dihasilkan",
      latestBarLive: "bilah terakhir data on-chain langsung",
      monthsActive: "Bulan Aktif",
      exportFormatsLabel: "Format Ekspor",
      revisionsLabel: "Revisi",
    },
    ms: {
      tagline: "Agen Penyelidikan Autonomi",
      heroBadge: "Kecerdasan akademik berkuasa Stacks",
      heroTitle: "Ubah sumber penyelidikan kepada ruang kerja tesis yang kemas.",
      heroDesc: "ThesisAI menggabungkan AI berkelajuan Groq, penulisan sedar-sitasi, alat eksport, dan pelan tindak lapisan bukti berasaskan Stacks supaya pelajar boleh bergerak daripada sumber mentah ke kerja akademik berstruktur tanpa keliru.",
      launchStudio: "Lancarkan Studio Penyelidikan",
      connectStacks: "Terokai Lapisan Stacks",
      stacksNote: "Dibina dengan pelan keselamatan bertaraf Stacks: provenans penyelidikan yang boleh disahkan, pembuktian cincang dokumen, dan pengesahan on-chain masa depan — tanpa mengganggu aliran penulisan anda.",
      aiModels: "Rangkaian Model AI Groq",
      aiModelsDesc: "Mengarahkan tugas penyelidikan merentasi Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, dan model sandaran pantas dari pelayan.",
      sourceIngestion: "Pengambilan Sumber",
      sourceIngestionDesc: "Tambah URL, tampal teks, atau muat naik dokumen PDF/TXT/MD sebagai asas pengetahuan berpandu sebelum penjanaan.",
      thesisWorkflow: "Aliran Kerja Tesis",
      thesisWorkflowDesc: "Jana tajuk, struktur, bab, rujukan, semakan, dan eksport dalam satu ruang kerja responsif yang lancar.",
      stacksLayer: "Lapisan Bukti Stacks",
      stacksLayerDesc: "Direka untuk bukti penyelidikan masa depan, insentif sBTC, dan integrasi kontrak pintar Clarity di Stacks.",
      create: "Cipta",
      dashboard: "Papan Pemuka",
      about: "Tentang",
      signIn: "Log Masuk",
      signOut: "Log Keluar",
      newThesis: "Tesis Baharu",
      myLibrary: "Perpustakaan Penyelidikan Saya",
      manageDrafts: "Urus draf tesis dan kerja penyelidikan yang disimpan.",
      noSavedFound: "Tiada Tesis Disimpan Ditemui",
      startGenerating: "Mula jana tesis dan simpan untuk melihatnya di sini dalam perpustakaan peribadi anda.",
      initiate: "Mulakan Penjanaan",
      openDraft: "Buka Draf",
      saveDraft: "Simpan Draf",
      exportPptx: "Eksport PPTX",
      exportPdf: "Eksport PDF",
      regenerate: "Jana Semula Bab",
      aboutTitle: "Tentang ThesisAI",
      aboutDesc: "ThesisAI adalah ruang kerja penyelidikan autonomi berasaskan Stacks yang mengubah sumber yang diberikan pengguna kepada draf akademik berstruktur sambil menyediakan produk untuk provenans dokumen yang boleh disahkan pada infrastruktur berasaskan Stacks.",
      disclaimerTitle: "Penafian & Etika",
      disclaimerDesc: "Alat ini adalah pembantu AI. AI boleh berhalusinasi atau menghasilkan maklumat yang tidak tepat. Sentiasa sahkan fakta dan sitasi. ThesisAI bertujuan untuk membantu, bukan menggantikan, pemikiran kritis. Gunakan secara bertanggungjawab dan patuhi garis panduan integriti akademik institusi anda.",
      donationTitle: "Sokong Projek Ini",
      donationDesc: "Projek ini dibangunkan secara bebas untuk membantu pelajar di seluruh dunia. Jika anda mendapati ia membantu, pertimbangkan untuk menyokong penyelenggaraan dan pembangunan selanjutnya.",
      languageName: "Bahasa Melayu",
      saveConfirmation: "Tesis berjaya disimpan!",
      loginRequirement: "Sila log masuk dahulu untuk menyimpan kemajuan anda.",
      revertConfirmation: "Adakah anda pasti mahu kembali ke versi ini? Sebarang perubahan yang belum disimpan pada paparan semasa akan hilang.",
      step1Title: "Asas Pengetahuan",
      step1Desc: "Muat naik PDF, tampal URL, atau masukkan teks mentah untuk membimbing penyelidikan AI.",
      addUrl: "Tambah URL",
      pasteText: "Tampal Teks",
      configureTitle: "Perhalusi Output",
      major: "Jurusan Akademik",
      thesisLevel: "Tahap Tesis",
      writingStyle: "Gaya Penulisan",
      citationStyle: "Gaya Sitasi",
      generateFull: "Jana Tesis Lengkap",
      processing: "Memproses...",
      thesisTitle: "Tajuk Tesis (Pilihan)",
      titlePlaceholder: "Biarkan AI tentukan atau taip sendiri...",
      generateTitles: "Jana Pilihan Tajuk daripada sumber",
      antiPlagiarismDesc: "Parafrasa semula jadi untuk mengurangkan skor kesamaan.",
      language: "Bahasa Sasaran",
      contentLength: "Panjang Kandungan",
      fontProfile: "Profil Fon",
      antiPlagiarism: "Anti-Plagiarisme",
      ctaBadge: "Sedia Tesis",
      ctaTitle: "Output bertaraf akademik, provenans penyelidikan on-chain seterusnya.",
      ctaDesc: "Pelan tindak Stacks: cincang dokumen akhir dengan Clarity, keluarkan lencana pemeriksa, dan tambah insentif berasaskan sBTC untuk penyumbang seiring perkembangan provenans penyelidikan.",
      ctaButton: "Mula Menulis Sekarang",
      walletGuideTitle: "Cara Menyambungkan Dompet Anda",
      walletGuideDesc: "Sambungkan dompet Stacks anda untuk memeriksa baki $THESIS dan mencetak Sijil Tesis anda on-chain.",
      walletGuideStep1: "Pasang sambungan dompet Leather atau Xverse dalam pelayar anda",
      walletGuideStep2: "Klik butang \"Connect Stacks\" pada navigasi atas",
      walletGuideStep3: "Luluskan permintaan sambungan dalam popup dompet anda",
      walletGuideStep4: "Baki $THESIS anda akan muncul secara automatik",
      walletGuideMobile: "Pada telefon, buka laman ini dalam pelayar dalam-aplikasi Leather atau Xverse untuk akses dompet.",
      walletGuideLeather: "Dapatkan Dompet Leather",
      walletGuideXverse: "Dapatkan Dompet Xverse",
      walletGuideLoginTitle: "Log Masuk untuk Akses Papan Pemuka Anda",
      walletGuideLoginDesc: "Log masuk dengan Google untuk menyimpan draf tesis, melihat sejarah penjanaan, dan menguruskan perpustakaan penyelidikan anda di semua peranti.",
      walletGuideLoginBtn: "Log masuk dengan Google",
      walletGuideOrHold: "Atau pegang 1,000 token $THESIS",
      stakeTitle: "Buka Akses Penuh",
      stakeDesc: "Buka semua ciri ThesisAI dengan memegang 1,000 token $THESIS dalam dompet yang disambungkan.",
      stakeOption1: "Pegang 1,000 $THESIS",
      stakeOption1Desc: "Pegang sekurang-kurangnya 1,000 token $THESIS dalam dompet Stacks yang disambungkan untuk membuka semua ciri secara kekal.",
      stakeCheckBalance: "Semak Baki $THESIS Saya",

      saveUnlimitedDrafts: "Simpan draf tesis tanpa had ke perpustakaan anda",
      accessGenHistory: "Akses sejarah penjanaan & semakan",
      syncDevices: "Segerakkan secara automatik di semua peranti",
      viewCertificates: "Lihat & urus sijil yang dicetak",
      signedInAsPrefix: "Log masuk sebagai",
      accessGate: "Pintu Akses",
      activeNow: "Aktif Sekarang",
      connectWalletBtn: "Sambungkan Dompet",
      communityTraction: "Penerimaan Komuniti",
      researchersGenerating: "Penyelidik sudah mula menjana.",
      thesesGenerated: "Tesis Dijana",
      latestBarLive: "bar terkini adalah data on-chain langsung",
      monthsActive: "Bulan Aktif",
      exportFormatsLabel: "Format Eksport",
      revisionsLabel: "Semakan",
    },
    ar: {
      tagline: "وكيل بحث مستقل",
      heroBadge: "ذكاء أكاديمي مدعوم بـ Stacks",
      heroTitle: "حوّل مصادر البحث إلى مساحة عمل أطروحة منظمة.",
      heroDesc: "يجمع ThesisAI بين الذكاء الاصطناعي بسرعة Groq، والكتابة الواعية بالاستشهادات، وأدوات التصدير، وخارطة طريق لطبقة إثبات مؤمّنة بـ Stacks، لتمكين الطلاب من الانتقال من المصادر الخام إلى عمل أكاديمي منظم دون تشويش.",
      launchStudio: "ابدأ استوديو البحث",
      connectStacks: "استكشف طبقة Stacks",
      stacksNote: "مبني مع خارطة طريق أمان بمستوى Stacks: إثبات أصالة البحث القابل للتحقق، وإثبات تجزئة الوثائق، والتحقق المستقبلي على السلسلة — دون تعطيل تسلسل كتابتك.",
      aiModels: "شبكة نماذج Groq AI",
      aiModelsDesc: "يوجّه مهام البحث عبر Llama 3.3 70B وQwen3 32B وDeepSeek R1 Distill ونماذج احتياطية سريعة من الخادم.",
      sourceIngestion: "استيعاب المصادر",
      sourceIngestionDesc: "أضف عناوين URL، أو ألصق نصًا، أو حمّل وثائق PDF/TXT/MD كقاعدة معرفية موجهة قبل التوليد.",
      thesisWorkflow: "سير عمل الأطروحة",
      thesisWorkflowDesc: "أنشئ العناوين والهياكل والفصول والمراجع والتنقيحات والتصديرات في مساحة عمل واحدة سلسة ومتجاوبة.",
      stacksLayer: "طبقة إثبات Stacks",
      stacksLayerDesc: "مصممة لإثبات البحث المستقبلي، وحوافز sBTC، وتكامل العقود الذكية Clarity على Stacks.",
      create: "إنشاء",
      dashboard: "لوحة التحكم",
      about: "حول",
      signIn: "تسجيل الدخول",
      signOut: "تسجيل الخروج",
      newThesis: "أطروحة جديدة",
      myLibrary: "مكتبة بحثي",
      manageDrafts: "إدارة مسودات الأطروحة وأعمال البحث المحفوظة.",
      noSavedFound: "لم يتم العثور على أطروحات محفوظة",
      startGenerating: "ابدأ بإنشاء أطروحة واحفظها لتراها هنا في مكتبتك الشخصية.",
      initiate: "بدء التوليد",
      openDraft: "فتح المسودة",
      saveDraft: "حفظ المسودة",
      exportPptx: "تصدير PPTX",
      exportPdf: "تصدير PDF",
      regenerate: "إعادة إنشاء الفصل",
      aboutTitle: "حول ThesisAI",
      aboutDesc: "ThesisAI هي مساحة عمل بحثية مستقلة متوافقة مع Stacks تحوّل المصادر التي يقدمها المستخدم إلى مسودات أكاديمية منظمة، مع تجهيز المنتج لإثبات أصالة الوثائق القابل للتحقق على بنية تحتية مؤمّنة بـ Stacks.",
      disclaimerTitle: "إخلاء المسؤولية والأخلاقيات",
      disclaimerDesc: "هذه الأداة مساعد ذكاء اصطناعي. قد يهلوس الذكاء الاصطناعي أو ينتج معلومات غير دقيقة. تحقق دائمًا من الحقائق والاستشهادات. يهدف ThesisAI إلى المساعدة، لا استبدال، التفكير النقدي. استخدمه بمسؤولية واتبع إرشادات النزاهة الأكاديمية في مؤسستك.",
      donationTitle: "ادعم هذا المشروع",
      donationDesc: "تم تطوير هذا المشروع بشكل مستقل لمساعدة الطلاب حول العالم. إذا وجدته مفيدًا، فكر في دعم صيانته وتطويره المستمر.",
      languageName: "العربية",
      saveConfirmation: "تم حفظ الأطروحة بنجاح!",
      loginRequirement: "يرجى تسجيل الدخول أولاً لحفظ تقدمك.",
      revertConfirmation: "هل أنت متأكد من رغبتك في العودة إلى هذا الإصدار؟ ستفقد أي تغييرات غير محفوظة في العرض الحالي.",
      step1Title: "قاعدة المعرفة",
      step1Desc: "حمّل ملفات PDF، أو ألصق عناوين URL، أو أدخل نصًا خامًا لتوجيه بحث الذكاء الاصطناعي.",
      addUrl: "إضافة رابط",
      pasteText: "لصق نص",
      configureTitle: "تحسين المخرجات",
      major: "التخصص الأكاديمي",
      thesisLevel: "مستوى الأطروحة",
      writingStyle: "أسلوب الكتابة",
      citationStyle: "نمط الاستشهاد",
      generateFull: "إنشاء الأطروحة الكاملة",
      processing: "جاري المعالجة...",
      thesisTitle: "عنوان الأطروحة (اختياري)",
      titlePlaceholder: "اترك الذكاء الاصطناعي يقرر أو اكتب عنوانك الخاص...",
      generateTitles: "إنشاء خيارات العنوان من المصادر",
      antiPlagiarismDesc: "إعادة صياغة طبيعية لتقليل درجة التشابه.",
      language: "اللغة المستهدفة",
      contentLength: "طول المحتوى",
      fontProfile: "ملف الخط",
      antiPlagiarism: "مكافحة الانتحال",
      ctaBadge: "جاهز للأطروحة",
      ctaTitle: "مخرجات بمستوى أكاديمي، وإثبات أصالة بحث على السلسلة قادم.",
      ctaDesc: "خارطة طريق Stacks: تثبيت تجزئات الوثائق النهائية بـ Clarity، وإصدار شارات المراجعين، وإضافة حوافز متوافقة مع sBTC للمساهمين مع تطور إثبات أصالة البحث.",
      ctaButton: "ابدأ الكتابة الآن",
      walletGuideTitle: "كيفية ربط محفظتك",
      walletGuideDesc: "اربط محفظة Stacks الخاصة بك للتحقق من رصيد $THESIS وسك شهادة الأطروحة الخاصة بك على السلسلة.",
      walletGuideStep1: "ثبّت ملحق محفظة Leather أو Xverse في متصفحك",
      walletGuideStep2: "انقر على زر \"Connect Stacks\" في شريط التنقل العلوي",
      walletGuideStep3: "وافق على طلب الاتصال في نافذة محفظتك المنبثقة",
      walletGuideStep4: "سيظهر رصيد $THESIS الخاص بك تلقائيًا",
      walletGuideMobile: "على الهاتف، افتح هذا الموقع داخل متصفح Leather أو Xverse المدمج في التطبيق للوصول إلى المحفظة.",
      walletGuideLeather: "احصل على محفظة Leather",
      walletGuideXverse: "احصل على محفظة Xverse",
      walletGuideLoginTitle: "سجّل الدخول للوصول إلى لوحة التحكم",
      walletGuideLoginDesc: "سجّل الدخول بحساب Google لحفظ مسودات أطروحتك، وعرض سجل الإنشاء، وإدارة مكتبة بحثك عبر جميع الأجهزة.",
      walletGuideLoginBtn: "تسجيل الدخول بحساب Google",
      walletGuideOrHold: "أو احتفظ بـ 1,000 رمز $THESIS",
      stakeTitle: "فتح الوصول الكامل",
      stakeDesc: "افتح جميع ميزات ThesisAI بالاحتفاظ بـ 1,000 رمز $THESIS في محفظتك المتصلة.",
      stakeOption1: "احتفظ بـ 1,000 $THESIS",
      stakeOption1Desc: "احتفظ بما لا يقل عن 1,000 رمز $THESIS في محفظة Stacks المتصلة لفتح جميع الميزات بشكل دائم.",
      stakeCheckBalance: "تحقق من رصيد $THESIS الخاص بي",

      saveUnlimitedDrafts: "حفظ مسودات أطروحة غير محدودة في مكتبتك",
      accessGenHistory: "الوصول إلى سجل الإنشاء والمراجعات",
      syncDevices: "المزامنة التلقائية عبر جميع الأجهزة",
      viewCertificates: "عرض وإدارة الشهادات المسكوكة",
      signedInAsPrefix: "تم تسجيل الدخول كـ",
      accessGate: "بوابة الوصول",
      activeNow: "نشط الآن",
      connectWalletBtn: "ربط المحفظة",
      communityTraction: "تفاعل المجتمع",
      researchersGenerating: "الباحثون يقومون بالإنشاء بالفعل.",
      thesesGenerated: "الأطروحات المُنشأة",
      latestBarLive: "الشريط الأخير هو بيانات مباشرة على السلسلة",
      monthsActive: "شهور النشاط",
      exportFormatsLabel: "صيغ التصدير",
      revisionsLabel: "المراجعات",
    },
    es: {
      tagline: "Agente de Investigación Autónomo",
      heroBadge: "Inteligencia académica impulsada por Stacks",
      heroTitle: "Convierte fuentes de investigación en un espacio de trabajo de tesis pulido.",
      heroDesc: "ThesisAI combina IA con la velocidad de Groq, redacción consciente de citas, herramientas de exportación y una hoja de ruta de capa de prueba asegurada por Stacks para que los estudiantes pasen de fuentes en bruto a trabajo académico estructurado sin perderse.",
      launchStudio: "Iniciar Estudio de Investigación",
      connectStacks: "Explorar la Capa Stacks",
      stacksNote: "Construido con una hoja de ruta de seguridad de nivel Stacks: procedencia de investigación verificable, prueba de hash de documentos y validación futura en cadena, sin interrumpir tu flujo de escritura.",
      aiModels: "Red de Modelos de IA Groq",
      aiModelsDesc: "Dirige tareas de investigación a través de Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill y modelos de respaldo rápido desde el servidor.",
      sourceIngestion: "Ingesta de Fuentes",
      sourceIngestionDesc: "Añade URLs, pega texto o sube documentos PDF/TXT/MD como base de conocimiento guiada antes de la generación.",
      thesisWorkflow: "Flujo de Trabajo de Tesis",
      thesisWorkflowDesc: "Genera títulos, estructuras, capítulos, referencias, revisiones y exportaciones en un espacio de trabajo fluido y responsivo.",
      stacksLayer: "Capa de Prueba Stacks",
      stacksLayerDesc: "Diseñado para prueba de investigación futura, incentivos sBTC e integración de contratos inteligentes Clarity en Stacks.",
      create: "Crear",
      dashboard: "Panel",
      about: "Acerca de",
      signIn: "Iniciar Sesión",
      signOut: "Cerrar Sesión",
      newThesis: "Nueva Tesis",
      myLibrary: "Mi Biblioteca de Investigación",
      manageDrafts: "Gestiona tus borradores de tesis guardados y trabajo de investigación.",
      noSavedFound: "No se Encontraron Tesis Guardadas",
      startGenerating: "Comienza a generar una tesis y guárdala para verla aquí en tu biblioteca personal.",
      initiate: "Iniciar Generación",
      openDraft: "Abrir Borrador",
      saveDraft: "Guardar Borrador",
      exportPptx: "Exportar PPTX",
      exportPdf: "Exportar PDF",
      regenerate: "Regenerar Capítulo",
      aboutTitle: "Acerca de ThesisAI",
      aboutDesc: "ThesisAI es un espacio de trabajo de investigación autónomo alineado con Stacks que convierte las fuentes proporcionadas por el usuario en borradores académicos estructurados, mientras prepara el producto para la procedencia de documentos verificable en infraestructura asegurada por Stacks.",
      disclaimerTitle: "Descargo de Responsabilidad y Ética",
      disclaimerDesc: "Esta herramienta es un asistente de IA. La IA puede alucinar o producir información inexacta. Siempre verifica los hechos y las citas. ThesisAI está destinado a asistir, no reemplazar, el pensamiento crítico. Úsalo de manera responsable y cumple con las pautas de integridad académica de tu institución.",
      donationTitle: "Apoya el Proyecto",
      donationDesc: "Este proyecto se desarrolla de forma independiente para ayudar a estudiantes en todo el mundo. Si te resulta útil, considera apoyar su mantenimiento y desarrollo continuo.",
      languageName: "Español",
      saveConfirmation: "¡Tesis guardada con éxito!",
      loginRequirement: "Por favor inicia sesión primero para guardar tu progreso.",
      revertConfirmation: "¿Estás seguro de que quieres revertir a esta versión? Se perderán los cambios no guardados en la vista actual.",
      step1Title: "Base de Conocimiento",
      step1Desc: "Sube PDFs, pega URLs o ingresa texto en bruto para guiar la investigación de la IA.",
      addUrl: "Añadir URL",
      pasteText: "Pegar Texto",
      configureTitle: "Refinar Salida",
      major: "Especialidad Académica",
      thesisLevel: "Nivel de Tesis",
      writingStyle: "Estilo de Escritura",
      citationStyle: "Estilo de Cita",
      generateFull: "Generar Tesis Completa",
      processing: "Procesando...",
      thesisTitle: "Título de la Tesis (Opcional)",
      titlePlaceholder: "Deja que la IA decida o escribe el tuyo...",
      generateTitles: "Generar Opciones de Título a partir de fuentes",
      antiPlagiarismDesc: "Parafrasea de forma natural para reducir la puntuación de similitud.",
      language: "Idioma de Destino",
      contentLength: "Longitud del Contenido",
      fontProfile: "Perfil de Fuente",
      antiPlagiarism: "Anti-Plagio",
      ctaBadge: "Listo para Tesis",
      ctaTitle: "Salida de nivel académico, procedencia de investigación en cadena a continuación.",
      ctaDesc: "Hoja de ruta Stacks: anclar hashes de documentos finales con Clarity, emitir insignias de revisores y añadir incentivos alineados con sBTC para colaboradores a medida que evoluciona la procedencia de investigación.",
      ctaButton: "Comenzar a Escribir Ahora",
      walletGuideTitle: "Cómo Conectar tu Billetera",
      walletGuideDesc: "Conecta tu billetera Stacks para verificar tu saldo $THESIS y acuñar tu Certificado de Tesis en cadena.",
      walletGuideStep1: "Instala la extensión de billetera Leather o Xverse en tu navegador",
      walletGuideStep2: "Haz clic en el botón \"Connect Stacks\" en la navegación superior",
      walletGuideStep3: "Aprueba la solicitud de conexión en la ventana emergente de tu billetera",
      walletGuideStep4: "Tu saldo $THESIS aparecerá automáticamente",
      walletGuideMobile: "En el móvil, abre este sitio dentro del navegador integrado de Leather o Xverse para acceder a la billetera.",
      walletGuideLeather: "Obtener Billetera Leather",
      walletGuideXverse: "Obtener Billetera Xverse",
      walletGuideLoginTitle: "Inicia Sesión para Acceder a tu Panel",
      walletGuideLoginDesc: "Inicia sesión con Google para guardar tus borradores de tesis, ver el historial de generación y gestionar tu biblioteca de investigación en todos los dispositivos.",
      walletGuideLoginBtn: "Iniciar sesión con Google",
      walletGuideOrHold: "O mantén 1,000 tokens $THESIS",
      stakeTitle: "Desbloquear Acceso Completo",
      stakeDesc: "Desbloquea todas las funciones de ThesisAI manteniendo 1,000 tokens $THESIS en tu billetera conectada.",
      stakeOption1: "Mantener 1,000 $THESIS",
      stakeOption1Desc: "Mantén al menos 1,000 tokens $THESIS en tu billetera Stacks conectada para desbloquear todas las funciones de forma permanente.",
      stakeCheckBalance: "Verificar Mi Saldo $THESIS",

      saveUnlimitedDrafts: "Guarda borradores de tesis ilimitados en tu biblioteca",
      accessGenHistory: "Accede al historial de generación y revisiones",
      syncDevices: "Sincroniza automáticamente entre dispositivos",
      viewCertificates: "Ver y gestionar certificados acuñados",
      signedInAsPrefix: "Sesión iniciada como",
      accessGate: "Puerta de Acceso",
      activeNow: "Activo Ahora",
      connectWalletBtn: "Conectar Billetera",
      communityTraction: "Tracción de la Comunidad",
      researchersGenerating: "Los investigadores ya están generando.",
      thesesGenerated: "Tesis Generadas",
      latestBarLive: "la última barra son datos en vivo en cadena",
      monthsActive: "Meses Activos",
      exportFormatsLabel: "Formatos de Exportación",
      revisionsLabel: "Revisiones",
    },
    pt: {
      tagline: "Agente de Pesquisa Autônomo",
      heroBadge: "Inteligência acadêmica com tecnologia Stacks",
      heroTitle: "Transforme fontes de pesquisa em um espaço de trabalho de tese refinado.",
      heroDesc: "O ThesisAI combina IA com a velocidade do Groq, redação consciente de citações, ferramentas de exportação e um roteiro de camada de prova protegida pela Stacks para que os estudantes avancem de fontes brutas para trabalho acadêmico estruturado sem se perder.",
      launchStudio: "Iniciar Estúdio de Pesquisa",
      connectStacks: "Explorar a Camada Stacks",
      stacksNote: "Construído com um roteiro de segurança de nível Stacks: proveniência de pesquisa verificável, prova de hash de documentos e validação futura on-chain — sem interromper seu fluxo de escrita.",
      aiModels: "Malha de Modelos de IA Groq",
      aiModelsDesc: "Direciona tarefas de pesquisa entre Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill e modelos de backup rápido do servidor.",
      sourceIngestion: "Ingestão de Fontes",
      sourceIngestionDesc: "Adicione URLs, cole texto ou envie documentos PDF/TXT/MD como base de conhecimento guiada antes da geração.",
      thesisWorkflow: "Fluxo de Trabalho da Tese",
      thesisWorkflowDesc: "Gere títulos, estruturas, capítulos, referências, revisões e exportações em um espaço de trabalho fluido e responsivo.",
      stacksLayer: "Camada de Prova Stacks",
      stacksLayerDesc: "Projetado para prova de pesquisa futura, incentivos sBTC e integração de contratos inteligentes Clarity na Stacks.",
      create: "Criar",
      dashboard: "Painel",
      about: "Sobre",
      signIn: "Entrar",
      signOut: "Sair",
      newThesis: "Nova Tese",
      myLibrary: "Minha Biblioteca de Pesquisa",
      manageDrafts: "Gerencie seus rascunhos de tese salvos e trabalho de pesquisa.",
      noSavedFound: "Nenhuma Tese Salva Encontrada",
      startGenerating: "Comece a gerar uma tese e salve-a para vê-la aqui em sua biblioteca pessoal.",
      initiate: "Iniciar Geração",
      openDraft: "Abrir Rascunho",
      saveDraft: "Salvar Rascunho",
      exportPptx: "Exportar PPTX",
      exportPdf: "Exportar PDF",
      regenerate: "Regenerar Capítulo",
      aboutTitle: "Sobre o ThesisAI",
      aboutDesc: "O ThesisAI é um espaço de trabalho de pesquisa autônomo alinhado com a Stacks que transforma fontes fornecidas pelo usuário em rascunhos acadêmicos estruturados, ao mesmo tempo que prepara o produto para proveniência de documentos verificável em infraestrutura protegida pela Stacks.",
      disclaimerTitle: "Aviso Legal e Ética",
      disclaimerDesc: "Esta ferramenta é um assistente de IA. A IA pode alucinar ou produzir informações inexatas. Sempre verifique fatos e citações. O ThesisAI destina-se a auxiliar, não substituir, o pensamento crítico. Use com responsabilidade e siga as diretrizes de integridade acadêmica de sua instituição.",
      donationTitle: "Apoie o Projeto",
      donationDesc: "Este projeto é desenvolvido de forma independente para ajudar estudantes em todo o mundo. Se você o considera útil, considere apoiar sua manutenção e desenvolvimento contínuo.",
      languageName: "Português",
      saveConfirmation: "Tese salva com sucesso!",
      loginRequirement: "Por favor, entre primeiro para salvar seu progresso.",
      revertConfirmation: "Tem certeza de que deseja reverter para esta versão? Quaisquer alterações não salvas na exibição atual serão perdidas.",
      step1Title: "Base de Conhecimento",
      step1Desc: "Envie PDFs, cole URLs ou insira texto bruto para guiar a pesquisa da IA.",
      addUrl: "Adicionar URL",
      pasteText: "Colar Texto",
      configureTitle: "Refinar Saída",
      major: "Área Acadêmica",
      thesisLevel: "Nível da Tese",
      writingStyle: "Estilo de Escrita",
      citationStyle: "Estilo de Citação",
      generateFull: "Gerar Tese Completa",
      processing: "Processando...",
      thesisTitle: "Título da Tese (Opcional)",
      titlePlaceholder: "Deixe a IA decidir ou digite o seu próprio...",
      generateTitles: "Gerar Opções de Título a partir de fontes",
      antiPlagiarismDesc: "Reformula naturalmente para reduzir a pontuação de similaridade.",
      language: "Idioma de Destino",
      contentLength: "Tamanho do Conteúdo",
      fontProfile: "Perfil de Fonte",
      antiPlagiarism: "Anti-Plágio",
      ctaBadge: "Pronto para Tese",
      ctaTitle: "Saída de nível acadêmico, proveniência de pesquisa on-chain em seguida.",
      ctaDesc: "Roteiro Stacks: ancorar hashes de documentos finais com Clarity, emitir distintivos de revisores e adicionar incentivos alinhados com sBTC para colaboradores conforme a proveniência da pesquisa evolui.",
      ctaButton: "Comece a Escrever Agora",
      walletGuideTitle: "Como Conectar sua Carteira",
      walletGuideDesc: "Conecte sua carteira Stacks para verificar seu saldo $THESIS e cunhar seu Certificado de Tese on-chain.",
      walletGuideStep1: "Instale a extensão de carteira Leather ou Xverse em seu navegador",
      walletGuideStep2: "Clique no botão \"Connect Stacks\" na navegação superior",
      walletGuideStep3: "Aprove a solicitação de conexão no popup da sua carteira",
      walletGuideStep4: "Seu saldo $THESIS aparecerá automaticamente",
      walletGuideMobile: "No celular, abra este site dentro do navegador integrado do Leather ou Xverse para acesso à carteira.",
      walletGuideLeather: "Obter Carteira Leather",
      walletGuideXverse: "Obter Carteira Xverse",
      walletGuideLoginTitle: "Entre para Acessar seu Painel",
      walletGuideLoginDesc: "Entre com o Google para salvar seus rascunhos de tese, ver o histórico de geração e gerenciar sua biblioteca de pesquisa em todos os dispositivos.",
      walletGuideLoginBtn: "Entrar com o Google",
      walletGuideOrHold: "Ou mantenha 1.000 tokens $THESIS",
      stakeTitle: "Desbloquear Acesso Completo",
      stakeDesc: "Desbloqueie todos os recursos do ThesisAI mantendo 1.000 tokens $THESIS em sua carteira conectada.",
      stakeOption1: "Manter 1.000 $THESIS",
      stakeOption1Desc: "Mantenha pelo menos 1.000 tokens $THESIS em sua carteira Stacks conectada para desbloquear todos os recursos permanentemente.",
      stakeCheckBalance: "Verificar Meu Saldo $THESIS",

      saveUnlimitedDrafts: "Salve rascunhos de tese ilimitados em sua biblioteca",
      accessGenHistory: "Acesse o histórico de geração e revisões",
      syncDevices: "Sincronize automaticamente entre dispositivos",
      viewCertificates: "Visualizar e gerenciar certificados cunhados",
      signedInAsPrefix: "Conectado como",
      accessGate: "Portão de Acesso",
      activeNow: "Ativo Agora",
      connectWalletBtn: "Conectar Carteira",
      communityTraction: "Tração da Comunidade",
      researchersGenerating: "Pesquisadores já estão gerando.",
      thesesGenerated: "Teses Geradas",
      latestBarLive: "a barra mais recente são dados em tempo real on-chain",
      monthsActive: "Meses Ativos",
      exportFormatsLabel: "Formatos de Exportação",
      revisionsLabel: "Revisões",
    },
    ru: {
      tagline: "Автономный исследовательский агент",
      heroBadge: "Академический интеллект на базе Stacks",
      heroTitle: "Превратите источники исследования в продуманное рабочее пространство для диссертации.",
      heroDesc: "ThesisAI объединяет ИИ со скоростью Groq, написание с учётом цитирования, инструменты экспорта и план развития слоя доказательств на базе Stacks, чтобы студенты могли перейти от необработанных источников к структурированной академической работе без путаницы.",
      launchStudio: "Запустить Исследовательскую Студию",
      connectStacks: "Исследовать Слой Stacks",
      stacksNote: "Создано с учётом плана безопасности уровня Stacks: проверяемое происхождение исследования, доказательство хеша документа и будущая проверка на блокчейне — без нарушения вашего процесса написания.",
      aiModels: "Сеть Моделей ИИ Groq",
      aiModelsDesc: "Направляет исследовательские задачи через Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill и быстрые резервные модели с сервера.",
      sourceIngestion: "Загрузка Источников",
      sourceIngestionDesc: "Добавляйте URL-адреса, вставляйте текст или загружайте документы PDF/TXT/MD как управляемую базу знаний перед генерацией.",
      thesisWorkflow: "Рабочий Процесс Диссертации",
      thesisWorkflowDesc: "Создавайте заголовки, структуры, главы, ссылки, исправления и экспорт в одном плавном адаптивном рабочем пространстве.",
      stacksLayer: "Слой Доказательств Stacks",
      stacksLayerDesc: "Разработан для будущего доказательства исследований, стимулов sBTC и интеграции смарт-контрактов Clarity на Stacks.",
      create: "Создать",
      dashboard: "Панель управления",
      about: "О нас",
      signIn: "Войти",
      signOut: "Выйти",
      newThesis: "Новая Диссертация",
      myLibrary: "Моя Исследовательская Библиотека",
      manageDrafts: "Управляйте сохранёнными черновиками диссертации и исследовательской работой.",
      noSavedFound: "Сохранённых Диссертаций Не Найдено",
      startGenerating: "Начните создавать диссертацию и сохраните её, чтобы увидеть здесь, в своей личной библиотеке.",
      initiate: "Начать Генерацию",
      openDraft: "Открыть Черновик",
      saveDraft: "Сохранить Черновик",
      exportPptx: "Экспорт PPTX",
      exportPdf: "Экспорт PDF",
      regenerate: "Перегенерировать Главу",
      aboutTitle: "О ThesisAI",
      aboutDesc: "ThesisAI — это автономное исследовательское рабочее пространство, согласованное с Stacks, которое превращает предоставленные пользователем источники в структурированные академические черновики, одновременно готовя продукт для проверяемого происхождения документов на инфраструктуре, защищённой Stacks.",
      disclaimerTitle: "Отказ от Ответственности и Этика",
      disclaimerDesc: "Этот инструмент является помощником на основе ИИ. ИИ может галлюцинировать или выдавать неточную информацию. Всегда проверяйте факты и цитаты. ThesisAI предназначен для помощи, а не замены критического мышления. Используйте ответственно и соблюдайте принципы академической честности вашего учебного заведения.",
      donationTitle: "Поддержите Проект",
      donationDesc: "Этот проект разрабатывается независимо, чтобы помочь студентам по всему миру. Если он оказался полезен, рассмотрите возможность поддержать его обслуживание и дальнейшую разработку.",
      languageName: "Русский",
      saveConfirmation: "Диссертация успешно сохранена!",
      loginRequirement: "Пожалуйста, сначала войдите, чтобы сохранить свой прогресс.",
      revertConfirmation: "Вы уверены, что хотите вернуться к этой версии? Все несохранённые изменения в текущем виде будут потеряны.",
      step1Title: "База Знаний",
      step1Desc: "Загрузите PDF, вставьте URL-адреса или введите необработанный текст, чтобы направить исследование ИИ.",
      addUrl: "Добавить URL",
      pasteText: "Вставить Текст",
      configureTitle: "Уточнить Вывод",
      major: "Академическая Специализация",
      thesisLevel: "Уровень Диссертации",
      writingStyle: "Стиль Письма",
      citationStyle: "Стиль Цитирования",
      generateFull: "Создать Полную Диссертацию",
      processing: "Обработка...",
      thesisTitle: "Название Диссертации (Необязательно)",
      titlePlaceholder: "Позвольте ИИ решить или введите своё...",
      generateTitles: "Создать Варианты Заголовков из источников",
      antiPlagiarismDesc: "Естественно перефразирует для снижения показателя сходства.",
      language: "Целевой Язык",
      contentLength: "Длина Контента",
      fontProfile: "Профиль Шрифта",
      antiPlagiarism: "Антиплагиат",
      ctaBadge: "Готов к Диссертации",
      ctaTitle: "Вывод академического уровня, далее — происхождение исследования на блокчейне.",
      ctaDesc: "План развития Stacks: закрепление хешей итоговых документов с помощью Clarity, выдача значков рецензентам и добавление стимулов, согласованных с sBTC, для участников по мере развития происхождения исследований.",
      ctaButton: "Начать Писать Сейчас",
      walletGuideTitle: "Как Подключить Ваш Кошелёк",
      walletGuideDesc: "Подключите свой кошелёк Stacks, чтобы проверить баланс $THESIS и выпустить сертификат диссертации на блокчейне.",
      walletGuideStep1: "Установите расширение кошелька Leather или Xverse в своём браузере",
      walletGuideStep2: "Нажмите кнопку \"Connect Stacks\" в верхней навигации",
      walletGuideStep3: "Подтвердите запрос на подключение во всплывающем окне вашего кошелька",
      walletGuideStep4: "Ваш баланс $THESIS появится автоматически",
      walletGuideMobile: "На мобильном устройстве откройте этот сайт во встроенном браузере Leather или Xverse для доступа к кошельку.",
      walletGuideLeather: "Получить Кошелёк Leather",
      walletGuideXverse: "Получить Кошелёк Xverse",
      walletGuideLoginTitle: "Войдите для Доступа к Вашей Панели",
      walletGuideLoginDesc: "Войдите через Google, чтобы сохранять черновики диссертации, просматривать историю генерации и управлять своей исследовательской библиотекой на всех устройствах.",
      walletGuideLoginBtn: "Войти через Google",
      walletGuideOrHold: "Или держите 1000 токенов $THESIS",
      stakeTitle: "Разблокировать Полный Доступ",
      stakeDesc: "Разблокируйте все функции ThesisAI, удерживая 1000 токенов $THESIS в подключённом кошельке.",
      stakeOption1: "Держать 1000 $THESIS",
      stakeOption1Desc: "Держите не менее 1000 токенов $THESIS в подключённом кошельке Stacks, чтобы навсегда разблокировать все функции.",
      stakeCheckBalance: "Проверить Мой Баланс $THESIS",

      saveUnlimitedDrafts: "Сохраняйте неограниченное количество черновиков диссертации в своей библиотеке",
      accessGenHistory: "Доступ к истории генерации и исправлениям",
      syncDevices: "Автоматическая синхронизация между устройствами",
      viewCertificates: "Просмотр и управление выпущенными сертификатами",
      signedInAsPrefix: "Вы вошли как",
      accessGate: "Шлюз Доступа",
      activeNow: "Активно Сейчас",
      connectWalletBtn: "Подключить Кошелёк",
      communityTraction: "Активность Сообщества",
      researchersGenerating: "Исследователи уже создают работы.",
      thesesGenerated: "Создано Диссертаций",
      latestBarLive: "последний столбец — это живые данные блокчейна",
      monthsActive: "Месяцев Активности",
      exportFormatsLabel: "Форматы Экспорта",
      revisionsLabel: "Исправления",
    },
    fr: {
      tagline: "Agent de Recherche Autonome",
      heroBadge: "Intelligence académique alimentée par Stacks",
      heroTitle: "Transformez les sources de recherche en un espace de travail de thèse soigné.",
      heroDesc: "ThesisAI combine une IA à la vitesse de Groq, une rédaction consciente des citations, des outils d'exportation et une feuille de route de couche de preuve sécurisée par Stacks afin que les étudiants puissent passer de sources brutes à un travail académique structuré sans se perdre.",
      launchStudio: "Lancer le Studio de Recherche",
      connectStacks: "Explorer la Couche Stacks",
      stacksNote: "Construit avec une feuille de route de sécurité de niveau Stacks : provenance de recherche vérifiable, preuve de hachage de documents et validation future sur la chaîne — sans perturber votre flux d'écriture.",
      aiModels: "Réseau de Modèles IA Groq",
      aiModelsDesc: "Dirige les tâches de recherche entre Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill et des modèles de secours rapides depuis le serveur.",
      sourceIngestion: "Ingestion de Sources",
      sourceIngestionDesc: "Ajoutez des URLs, collez du texte ou téléchargez des documents PDF/TXT/MD comme base de connaissances guidée avant la génération.",
      thesisWorkflow: "Flux de Travail de Thèse",
      thesisWorkflowDesc: "Générez des titres, des structures, des chapitres, des références, des révisions et des exportations dans un espace de travail fluide et réactif.",
      stacksLayer: "Couche de Preuve Stacks",
      stacksLayerDesc: "Conçu pour la preuve de recherche future, les incitations sBTC et l'intégration de contrats intelligents Clarity sur Stacks.",
      create: "Créer",
      dashboard: "Tableau de Bord",
      about: "À Propos",
      signIn: "Se Connecter",
      signOut: "Se Déconnecter",
      newThesis: "Nouvelle Thèse",
      myLibrary: "Ma Bibliothèque de Recherche",
      manageDrafts: "Gérez vos brouillons de thèse enregistrés et votre travail de recherche.",
      noSavedFound: "Aucune Thèse Enregistrée Trouvée",
      startGenerating: "Commencez à générer une thèse et enregistrez-la pour la voir ici dans votre bibliothèque personnelle.",
      initiate: "Démarrer la Génération",
      openDraft: "Ouvrir le Brouillon",
      saveDraft: "Enregistrer le Brouillon",
      exportPptx: "Exporter en PPTX",
      exportPdf: "Exporter en PDF",
      regenerate: "Régénérer le Chapitre",
      aboutTitle: "À Propos de ThesisAI",
      aboutDesc: "ThesisAI est un espace de travail de recherche autonome aligné sur Stacks qui transforme les sources fournies par l'utilisateur en brouillons académiques structurés, tout en préparant le produit pour une provenance de documents vérifiable sur une infrastructure sécurisée par Stacks.",
      disclaimerTitle: "Avertissement et Éthique",
      disclaimerDesc: "Cet outil est un assistant IA. L'IA peut halluciner ou produire des informations inexactes. Vérifiez toujours les faits et les citations. ThesisAI est destiné à aider, non à remplacer, la pensée critique. Utilisez-le de manière responsable et respectez les directives d'intégrité académique de votre établissement.",
      donationTitle: "Soutenez le Projet",
      donationDesc: "Ce projet est développé de manière indépendante pour aider les étudiants du monde entier. Si vous le trouvez utile, envisagez de soutenir sa maintenance et son développement continu.",
      languageName: "Français",
      saveConfirmation: "Thèse enregistrée avec succès !",
      loginRequirement: "Veuillez vous connecter d'abord pour enregistrer votre progression.",
      revertConfirmation: "Êtes-vous sûr de vouloir revenir à cette version ? Toutes les modifications non enregistrées dans la vue actuelle seront perdues.",
      step1Title: "Base de Connaissances",
      step1Desc: "Téléchargez des PDF, collez des URLs ou saisissez du texte brut pour guider la recherche de l'IA.",
      addUrl: "Ajouter une URL",
      pasteText: "Coller du Texte",
      configureTitle: "Affiner la Sortie",
      major: "Spécialité Académique",
      thesisLevel: "Niveau de Thèse",
      writingStyle: "Style d'Écriture",
      citationStyle: "Style de Citation",
      generateFull: "Générer la Thèse Complète",
      processing: "Traitement en cours...",
      thesisTitle: "Titre de la Thèse (Optionnel)",
      titlePlaceholder: "Laissez l'IA décider ou tapez le vôtre...",
      generateTitles: "Générer des Options de Titre à partir des sources",
      antiPlagiarismDesc: "Reformule naturellement pour réduire le score de similarité.",
      language: "Langue Cible",
      contentLength: "Longueur du Contenu",
      fontProfile: "Profil de Police",
      antiPlagiarism: "Anti-Plagiat",
      ctaBadge: "Prêt pour la Thèse",
      ctaTitle: "Sortie de niveau académique, provenance de recherche sur la chaîne à venir.",
      ctaDesc: "Feuille de route Stacks : ancrer les hachages de documents finaux avec Clarity, délivrer des badges de réviseurs et ajouter des incitations alignées sur sBTC pour les contributeurs à mesure que la provenance de la recherche évolue.",
      ctaButton: "Commencer à Écrire Maintenant",
      walletGuideTitle: "Comment Connecter Votre Portefeuille",
      walletGuideDesc: "Connectez votre portefeuille Stacks pour vérifier votre solde $THESIS et frapper votre Certificat de Thèse sur la chaîne.",
      walletGuideStep1: "Installez l'extension de portefeuille Leather ou Xverse dans votre navigateur",
      walletGuideStep2: "Cliquez sur le bouton \"Connect Stacks\" dans la navigation supérieure",
      walletGuideStep3: "Approuvez la demande de connexion dans la fenêtre contextuelle de votre portefeuille",
      walletGuideStep4: "Votre solde $THESIS apparaîtra automatiquement",
      walletGuideMobile: "Sur mobile, ouvrez ce site dans le navigateur intégré de Leather ou Xverse pour accéder au portefeuille.",
      walletGuideLeather: "Obtenir le Portefeuille Leather",
      walletGuideXverse: "Obtenir le Portefeuille Xverse",
      walletGuideLoginTitle: "Connectez-vous pour Accéder à Votre Tableau de Bord",
      walletGuideLoginDesc: "Connectez-vous avec Google pour enregistrer vos brouillons de thèse, consulter l'historique de génération et gérer votre bibliothèque de recherche sur tous les appareils.",
      walletGuideLoginBtn: "Se connecter avec Google",
      walletGuideOrHold: "Ou détenez 1 000 jetons $THESIS",
      stakeTitle: "Débloquer l'Accès Complet",
      stakeDesc: "Débloquez toutes les fonctionnalités de ThesisAI en détenant 1 000 jetons $THESIS dans votre portefeuille connecté.",
      stakeOption1: "Détenir 1 000 $THESIS",
      stakeOption1Desc: "Détenez au moins 1 000 jetons $THESIS dans votre portefeuille Stacks connecté pour débloquer définitivement toutes les fonctionnalités.",
      stakeCheckBalance: "Vérifier Mon Solde $THESIS",

      saveUnlimitedDrafts: "Enregistrez un nombre illimité de brouillons de thèse dans votre bibliothèque",
      accessGenHistory: "Accédez à l'historique de génération et aux révisions",
      syncDevices: "Synchronisation automatique entre les appareils",
      viewCertificates: "Voir et gérer les certificats frappés",
      signedInAsPrefix: "Connecté en tant que",
      accessGate: "Porte d'Accès",
      activeNow: "Actif Maintenant",
      connectWalletBtn: "Connecter le Portefeuille",
      communityTraction: "Traction de la Communauté",
      researchersGenerating: "Les chercheurs génèrent déjà du contenu.",
      thesesGenerated: "Thèses Générées",
      latestBarLive: "la dernière barre est constituée de données en direct sur la chaîne",
      monthsActive: "Mois Actifs",
      exportFormatsLabel: "Formats d'Exportation",
      revisionsLabel: "Révisions",
    },
    vi: {
      tagline: "Tác Nhân Nghiên Cứu Tự Động",
      heroBadge: "Trí tuệ học thuật được hỗ trợ bởi Stacks",
      heroTitle: "Biến nguồn nghiên cứu thành không gian làm việc luận văn hoàn chỉnh.",
      heroDesc: "ThesisAI kết hợp AI với tốc độ Groq, viết bài có nhận thức về trích dẫn, công cụ xuất file, và lộ trình lớp bằng chứng được bảo mật bởi Stacks để sinh viên có thể chuyển từ nguồn thô sang công trình học thuật có cấu trúc mà không bị lạc lối.",
      launchStudio: "Khởi Động Studio Nghiên Cứu",
      connectStacks: "Khám Phá Lớp Stacks",
      stacksNote: "Được xây dựng với lộ trình an ninh đạt chuẩn Stacks: nguồn gốc nghiên cứu có thể xác minh, chứng minh hash tài liệu, và xác thực trên chuỗi trong tương lai — không làm gián đoạn luồng viết của bạn.",
      aiModels: "Mạng Lưới Mô Hình AI Groq",
      aiModelsDesc: "Định tuyến các tác vụ nghiên cứu qua Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, và các mô hình dự phòng nhanh từ máy chủ.",
      sourceIngestion: "Nạp Nguồn Dữ Liệu",
      sourceIngestionDesc: "Thêm URL, dán văn bản, hoặc tải lên tài liệu PDF/TXT/MD làm cơ sở kiến thức có hướng dẫn trước khi tạo nội dung.",
      thesisWorkflow: "Quy Trình Luận Văn",
      thesisWorkflowDesc: "Tạo tiêu đề, cấu trúc, chương, tài liệu tham khảo, sửa đổi, và xuất file trong một không gian làm việc mượt mà, đáp ứng tốt.",
      stacksLayer: "Lớp Bằng Chứng Stacks",
      stacksLayerDesc: "Được thiết kế cho bằng chứng nghiên cứu trong tương lai, ưu đãi sBTC, và tích hợp hợp đồng thông minh Clarity trên Stacks.",
      create: "Tạo Mới",
      dashboard: "Bảng Điều Khiển",
      about: "Giới Thiệu",
      signIn: "Đăng Nhập",
      signOut: "Đăng Xuất",
      newThesis: "Luận Văn Mới",
      myLibrary: "Thư Viện Nghiên Cứu Của Tôi",
      manageDrafts: "Quản lý bản nháp luận văn và công trình nghiên cứu đã lưu của bạn.",
      noSavedFound: "Không Tìm Thấy Luận Văn Đã Lưu",
      startGenerating: "Bắt đầu tạo một luận văn và lưu lại để xem ở đây trong thư viện cá nhân của bạn.",
      initiate: "Bắt Đầu Tạo",
      openDraft: "Mở Bản Nháp",
      saveDraft: "Lưu Bản Nháp",
      exportPptx: "Xuất PPTX",
      exportPdf: "Xuất PDF",
      regenerate: "Tạo Lại Chương",
      aboutTitle: "Giới Thiệu Về ThesisAI",
      aboutDesc: "ThesisAI là không gian làm việc nghiên cứu tự động phù hợp với Stacks, biến nguồn dữ liệu do người dùng cung cấp thành bản nháp học thuật có cấu trúc, đồng thời chuẩn bị sản phẩm cho nguồn gốc tài liệu có thể xác minh trên hạ tầng được bảo mật bởi Stacks.",
      disclaimerTitle: "Tuyên Bố Miễn Trừ & Đạo Đức",
      disclaimerDesc: "Công cụ này là trợ lý AI. AI có thể tạo ra thông tin ảo giác hoặc không chính xác. Luôn kiểm tra lại sự thật và trích dẫn. ThesisAI nhằm hỗ trợ, không thay thế, suy nghĩ phản biện. Hãy sử dụng có trách nhiệm và tuân theo các nguyên tắc liêm chính học thuật của cơ sở giáo dục của bạn.",
      donationTitle: "Hỗ Trợ Dự Án Này",
      donationDesc: "Dự án này được phát triển độc lập để giúp sinh viên trên toàn thế giới. Nếu bạn thấy hữu ích, hãy xem xét hỗ trợ việc duy trì và phát triển thêm.",
      languageName: "Tiếng Việt",
      saveConfirmation: "Đã lưu luận văn thành công!",
      loginRequirement: "Vui lòng đăng nhập trước để lưu tiến trình của bạn.",
      revertConfirmation: "Bạn có chắc muốn quay lại phiên bản này không? Mọi thay đổi chưa lưu trong chế độ xem hiện tại sẽ bị mất.",
      step1Title: "Cơ Sở Kiến Thức",
      step1Desc: "Tải lên PDF, dán URL, hoặc nhập văn bản thô để hướng dẫn nghiên cứu của AI.",
      addUrl: "Thêm URL",
      pasteText: "Dán Văn Bản",
      configureTitle: "Tinh Chỉnh Kết Quả",
      major: "Chuyên Ngành Học Thuật",
      thesisLevel: "Cấp Độ Luận Văn",
      writingStyle: "Phong Cách Viết",
      citationStyle: "Phong Cách Trích Dẫn",
      generateFull: "Tạo Luận Văn Đầy Đủ",
      processing: "Đang xử lý...",
      thesisTitle: "Tiêu Đề Luận Văn (Tùy Chọn)",
      titlePlaceholder: "Để AI quyết định hoặc nhập tiêu đề của riêng bạn...",
      generateTitles: "Tạo Các Tùy Chọn Tiêu Đề từ nguồn",
      antiPlagiarismDesc: "Diễn đạt lại một cách tự nhiên để giảm điểm tương đồng.",
      language: "Ngôn Ngữ Mục Tiêu",
      contentLength: "Độ Dài Nội Dung",
      fontProfile: "Hồ Sơ Phông Chữ",
      antiPlagiarism: "Chống Đạo Văn",
      ctaBadge: "Sẵn Sàng Cho Luận Văn",
      ctaTitle: "Kết quả đạt chuẩn học thuật, tiếp theo là nguồn gốc nghiên cứu trên chuỗi.",
      ctaDesc: "Lộ trình Stacks: lưu trữ hash tài liệu cuối cùng bằng Clarity, cấp huy hiệu cho người đánh giá, và thêm ưu đãi liên kết với sBTC cho người đóng góp khi nguồn gốc nghiên cứu phát triển.",
      ctaButton: "Bắt Đầu Viết Ngay",
      walletGuideTitle: "Cách Kết Nối Ví Của Bạn",
      walletGuideDesc: "Kết nối ví Stacks của bạn để kiểm tra số dư $THESIS và đúc Chứng Chỉ Luận Văn của bạn trên chuỗi.",
      walletGuideStep1: "Cài đặt tiện ích ví Leather hoặc Xverse trong trình duyệt của bạn",
      walletGuideStep2: "Nhấp vào nút \"Connect Stacks\" trên thanh điều hướng phía trên",
      walletGuideStep3: "Chấp thuận yêu cầu kết nối trong cửa sổ bật lên của ví bạn",
      walletGuideStep4: "Số dư $THESIS của bạn sẽ xuất hiện tự động",
      walletGuideMobile: "Trên di động, hãy mở trang này trong trình duyệt tích hợp của Leather hoặc Xverse để truy cập ví.",
      walletGuideLeather: "Lấy Ví Leather",
      walletGuideXverse: "Lấy Ví Xverse",
      walletGuideLoginTitle: "Đăng Nhập Để Truy Cập Bảng Điều Khiển Của Bạn",
      walletGuideLoginDesc: "Đăng nhập bằng Google để lưu bản nháp luận văn, xem lịch sử tạo nội dung, và quản lý thư viện nghiên cứu của bạn trên tất cả thiết bị.",
      walletGuideLoginBtn: "Đăng nhập bằng Google",
      walletGuideOrHold: "Hoặc giữ 1.000 token $THESIS",
      stakeTitle: "Mở Khóa Toàn Quyền Truy Cập",
      stakeDesc: "Mở khóa tất cả tính năng của ThesisAI bằng cách giữ 1.000 token $THESIS trong ví đã kết nối của bạn.",
      stakeOption1: "Giữ 1.000 $THESIS",
      stakeOption1Desc: "Giữ ít nhất 1.000 token $THESIS trong ví Stacks đã kết nối để mở khóa vĩnh viễn tất cả tính năng.",
      stakeCheckBalance: "Kiểm Tra Số Dư $THESIS Của Tôi",

      saveUnlimitedDrafts: "Lưu không giới hạn bản nháp luận văn vào thư viện của bạn",
      accessGenHistory: "Truy cập lịch sử tạo nội dung & sửa đổi",
      syncDevices: "Đồng bộ hóa tự động giữa các thiết bị",
      viewCertificates: "Xem & quản lý chứng chỉ đã đúc",
      signedInAsPrefix: "Đã đăng nhập với tên",
      accessGate: "Cổng Truy Cập",
      activeNow: "Đang Hoạt Động",
      connectWalletBtn: "Kết Nối Ví",
      communityTraction: "Sức Hút Cộng Đồng",
      researchersGenerating: "Các nhà nghiên cứu đã đang tạo nội dung.",
      thesesGenerated: "Luận Văn Đã Tạo",
      latestBarLive: "thanh gần nhất là dữ liệu trực tiếp trên chuỗi",
      monthsActive: "Tháng Hoạt Động",
      exportFormatsLabel: "Định Dạng Xuất",
      revisionsLabel: "Sửa Đổi",
    },
    th: {
      tagline: "ตัวแทนวิจัยอัตโนมัติ",
      heroBadge: "ปัญญาประดิษฐ์ทางวิชาการที่ขับเคลื่อนด้วย Stacks",
      heroTitle: "เปลี่ยนแหล่งข้อมูลวิจัยให้เป็นพื้นที่ทำงานวิทยานิพนธ์ที่เรียบร้อย",
      heroDesc: "ThesisAI ผสมผสาน AI ความเร็วระดับ Groq การเขียนที่ตระหนักถึงการอ้างอิง เครื่องมือส่งออก และแผนงานชั้นพิสูจน์ที่ปลอดภัยด้วย Stacks เพื่อให้นักศึกษาสามารถก้าวจากแหล่งข้อมูลดิบไปสู่งานวิชาการที่มีโครงสร้างโดยไม่หลงทาง",
      launchStudio: "เปิดสตูดิโอวิจัย",
      connectStacks: "สำรวจชั้น Stacks",
      stacksNote: "สร้างขึ้นด้วยแผนงานความปลอดภัยระดับ Stacks: แหล่งที่มาของงานวิจัยที่ตรวจสอบได้ การพิสูจน์แฮชเอกสาร และการตรวจสอบบนเชนในอนาคต — โดยไม่รบกวนกระบวนการเขียนของคุณ",
      aiModels: "เครือข่ายโมเดล AI ของ Groq",
      aiModelsDesc: "กำหนดเส้นทางงานวิจัยผ่าน Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill และโมเดลสำรองที่รวดเร็วจากเซิร์ฟเวอร์",
      sourceIngestion: "การนำเข้าแหล่งข้อมูล",
      sourceIngestionDesc: "เพิ่ม URL วางข้อความ หรืออัปโหลดเอกสาร PDF/TXT/MD เป็นฐานความรู้ที่มีการแนะนำก่อนการสร้างเนื้อหา",
      thesisWorkflow: "กระบวนการทำงานวิทยานิพนธ์",
      thesisWorkflowDesc: "สร้างชื่อเรื่อง โครงสร้าง บท เอกสารอ้างอิง การแก้ไข และการส่งออกในพื้นที่ทำงานที่ลื่นไหลและตอบสนองได้ดี",
      stacksLayer: "ชั้นพิสูจน์ Stacks",
      stacksLayerDesc: "ออกแบบมาเพื่อการพิสูจน์งานวิจัยในอนาคต สิ่งจูงใจ sBTC และการรวมสมาร์ทคอนแทรกต์ Clarity บน Stacks",
      create: "สร้าง",
      dashboard: "แดชบอร์ด",
      about: "เกี่ยวกับ",
      signIn: "เข้าสู่ระบบ",
      signOut: "ออกจากระบบ",
      newThesis: "วิทยานิพนธ์ใหม่",
      myLibrary: "คลังวิจัยของฉัน",
      manageDrafts: "จัดการแบบร่างวิทยานิพนธ์และงานวิจัยที่บันทึกไว้ของคุณ",
      noSavedFound: "ไม่พบวิทยานิพนธ์ที่บันทึกไว้",
      startGenerating: "เริ่มสร้างวิทยานิพนธ์และบันทึกเพื่อดูที่นี่ในคลังส่วนตัวของคุณ",
      initiate: "เริ่มการสร้าง",
      openDraft: "เปิดแบบร่าง",
      saveDraft: "บันทึกแบบร่าง",
      exportPptx: "ส่งออก PPTX",
      exportPdf: "ส่งออก PDF",
      regenerate: "สร้างบทใหม่",
      aboutTitle: "เกี่ยวกับ ThesisAI",
      aboutDesc: "ThesisAI คือพื้นที่ทำงานวิจัยอัตโนมัติที่สอดคล้องกับ Stacks ซึ่งเปลี่ยนแหล่งข้อมูลที่ผู้ใช้ให้มาเป็นแบบร่างทางวิชาการที่มีโครงสร้าง ขณะเดียวกันก็เตรียมผลิตภัณฑ์สำหรับแหล่งที่มาของเอกสารที่ตรวจสอบได้บนโครงสร้างพื้นฐานที่ปลอดภัยด้วย Stacks",
      disclaimerTitle: "ข้อสงวนสิทธิ์และจริยธรรม",
      disclaimerDesc: "เครื่องมือนี้เป็นผู้ช่วย AI ปัญญาประดิษฐ์อาจเกิดอาการหลอนหรือให้ข้อมูลที่ไม่ถูกต้อง โปรดตรวจสอบข้อเท็จจริงและการอ้างอิงเสมอ ThesisAI มีไว้เพื่อช่วยเหลือ ไม่ใช่แทนที่การคิดเชิงวิพากษ์ ใช้อย่างมีความรับผิดชอบและปฏิบัติตามแนวทางความซื่อสัตย์ทางวิชาการของสถาบันของคุณ",
      donationTitle: "สนับสนุนโครงการนี้",
      donationDesc: "โครงการนี้ได้รับการพัฒนาอย่างเป็นอิสระเพื่อช่วยนักศึกษาทั่วโลก หากคุณพบว่ามีประโยชน์ โปรดพิจารณาสนับสนุนการดูแลรักษาและการพัฒนาต่อไป",
      languageName: "ภาษาไทย",
      saveConfirmation: "บันทึกวิทยานิพนธ์สำเร็จแล้ว!",
      loginRequirement: "กรุณาเข้าสู่ระบบก่อนเพื่อบันทึกความคืบหน้าของคุณ",
      revertConfirmation: "คุณแน่ใจหรือไม่ว่าต้องการย้อนกลับไปยังเวอร์ชันนี้? การเปลี่ยนแปลงที่ยังไม่บันทึกในมุมมองปัจจุบันจะสูญหาย",
      step1Title: "ฐานความรู้",
      step1Desc: "อัปโหลด PDF วาง URL หรือป้อนข้อความดิบเพื่อแนะนำการวิจัยของ AI",
      addUrl: "เพิ่ม URL",
      pasteText: "วางข้อความ",
      configureTitle: "ปรับแต่งผลลัพธ์",
      major: "สาขาวิชา",
      thesisLevel: "ระดับวิทยานิพนธ์",
      writingStyle: "สไตล์การเขียน",
      citationStyle: "รูปแบบการอ้างอิง",
      generateFull: "สร้างวิทยานิพนธ์ฉบับสมบูรณ์",
      processing: "กำลังประมวลผล...",
      thesisTitle: "ชื่อวิทยานิพนธ์ (ไม่บังคับ)",
      titlePlaceholder: "ให้ AI ตัดสินใจหรือพิมพ์ของคุณเอง...",
      generateTitles: "สร้างตัวเลือกชื่อเรื่องจากแหล่งข้อมูล",
      antiPlagiarismDesc: "ถอดความตามธรรมชาติเพื่อลดคะแนนความคล้ายคลึง",
      language: "ภาษาเป้าหมาย",
      contentLength: "ความยาวเนื้อหา",
      fontProfile: "โปรไฟล์ฟอนต์",
      antiPlagiarism: "ป้องกันการลอกเลียนแบบ",
      ctaBadge: "พร้อมสำหรับวิทยานิพนธ์",
      ctaTitle: "ผลลัพธ์ระดับวิชาการ ถัดไปคือแหล่งที่มาของงานวิจัยบนเชน",
      ctaDesc: "แผนงาน Stacks: ยึดแฮชเอกสารฉบับสุดท้ายด้วย Clarity ออกเครื่องหมายผู้ตรวจสอบ และเพิ่มสิ่งจูงใจที่สอดคล้องกับ sBTC สำหรับผู้สนับสนุนตามการพัฒนาแหล่งที่มาของงานวิจัย",
      ctaButton: "เริ่มเขียนตอนนี้",
      walletGuideTitle: "วิธีเชื่อมต่อกระเป๋าเงินของคุณ",
      walletGuideDesc: "เชื่อมต่อกระเป๋าเงิน Stacks ของคุณเพื่อตรวจสอบยอดคงเหลือ $THESIS และสร้างใบรับรองวิทยานิพนธ์ของคุณบนเชน",
      walletGuideStep1: "ติดตั้งส่วนขยายกระเป๋าเงิน Leather หรือ Xverse ในเบราว์เซอร์ของคุณ",
      walletGuideStep2: "คลิกปุ่ม \"Connect Stacks\" ที่แถบนำทางด้านบน",
      walletGuideStep3: "อนุมัติคำขอเชื่อมต่อในป๊อปอัปกระเป๋าเงินของคุณ",
      walletGuideStep4: "ยอดคงเหลือ $THESIS ของคุณจะปรากฏขึ้นโดยอัตโนมัติ",
      walletGuideMobile: "บนมือถือ เปิดไซต์นี้ในเบราว์เซอร์ในแอปของ Leather หรือ Xverse เพื่อเข้าถึงกระเป๋าเงิน",
      walletGuideLeather: "รับกระเป๋าเงิน Leather",
      walletGuideXverse: "รับกระเป๋าเงิน Xverse",
      walletGuideLoginTitle: "เข้าสู่ระบบเพื่อเข้าถึงแดชบอร์ดของคุณ",
      walletGuideLoginDesc: "เข้าสู่ระบบด้วย Google เพื่อบันทึกแบบร่างวิทยานิพนธ์ ดูประวัติการสร้าง และจัดการคลังวิจัยของคุณในทุกอุปกรณ์",
      walletGuideLoginBtn: "เข้าสู่ระบบด้วย Google",
      walletGuideOrHold: "หรือถือ 1,000 โทเค็น $THESIS",
      stakeTitle: "ปลดล็อกการเข้าถึงแบบเต็ม",
      stakeDesc: "ปลดล็อกฟีเจอร์ทั้งหมดของ ThesisAI โดยการถือโทเค็น $THESIS จำนวน 1,000 ในกระเป๋าเงินที่เชื่อมต่อของคุณ",
      stakeOption1: "ถือ 1,000 $THESIS",
      stakeOption1Desc: "ถือโทเค็น $THESIS อย่างน้อย 1,000 ในกระเป๋าเงิน Stacks ที่เชื่อมต่อเพื่อปลดล็อกฟีเจอร์ทั้งหมดอย่างถาวร",
      stakeCheckBalance: "ตรวจสอบยอดคงเหลือ $THESIS ของฉัน",

      saveUnlimitedDrafts: "บันทึกแบบร่างวิทยานิพนธ์ไม่จำกัดลงในคลังของคุณ",
      accessGenHistory: "เข้าถึงประวัติการสร้างและการแก้ไข",
      syncDevices: "ซิงค์ข้อมูลข้ามอุปกรณ์โดยอัตโนมัติ",
      viewCertificates: "ดูและจัดการใบรับรองที่สร้างขึ้น",
      signedInAsPrefix: "เข้าสู่ระบบในชื่อ",
      accessGate: "ประตูการเข้าถึง",
      activeNow: "กำลังใช้งาน",
      connectWalletBtn: "เชื่อมต่อกระเป๋าเงิน",
      communityTraction: "การมีส่วนร่วมของชุมชน",
      researchersGenerating: "นักวิจัยกำลังสร้างผลงานอยู่แล้ว",
      thesesGenerated: "วิทยานิพนธ์ที่สร้างขึ้น",
      latestBarLive: "แถบล่าสุดเป็นข้อมูลสดบนเชน",
      monthsActive: "เดือนที่ใช้งาน",
      exportFormatsLabel: "รูปแบบการส่งออก",
      revisionsLabel: "การแก้ไข",
    },
    hi: {
      tagline: "स्वायत्त शोध एजेंट",
      heroBadge: "Stacks-संचालित अकादमिक बुद्धिमत्ता",
      heroTitle: "शोध स्रोतों को एक परिष्कृत थीसिस कार्यक्षेत्र में बदलें।",
      heroDesc: "ThesisAI Groq-गति AI, उद्धरण-जागरूक लेखन, निर्यात उपकरण, और Stacks-सुरक्षित प्रमाण लेयर रोडमैप को जोड़ता है ताकि छात्र कच्चे स्रोतों से संरचित अकादमिक कार्य की ओर बिना भटके बढ़ सकें।",
      launchStudio: "शोध स्टूडियो लॉन्च करें",
      connectStacks: "Stacks लेयर का अन्वेषण करें",
      stacksNote: "Stacks-स्तरीय सुरक्षा रोडमैप के साथ बनाया गया: सत्यापन योग्य शोध उद्गम, दस्तावेज़-हैश प्रूफिंग, और भविष्य का ऑन-चेन सत्यापन — आपके लेखन प्रवाह को बाधित किए बिना।",
      aiModels: "Groq AI मॉडल मेश",
      aiModelsDesc: "सर्वर से Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, और तेज़ बैकअप मॉडलों के माध्यम से शोध कार्यों को निर्देशित करता है।",
      sourceIngestion: "स्रोत समावेशन",
      sourceIngestionDesc: "जनरेशन से पहले मार्गदर्शित ज्ञान आधार के रूप में URL जोड़ें, टेक्स्ट पेस्ट करें, या PDF/TXT/MD दस्तावेज़ अपलोड करें।",
      thesisWorkflow: "थीसिस वर्कफ़्लो",
      thesisWorkflowDesc: "एक सहज, उत्तरदायी कार्यक्षेत्र में शीर्षक, संरचनाएँ, अध्याय, संदर्भ, संशोधन, और निर्यात उत्पन्न करें।",
      stacksLayer: "Stacks प्रूफ लेयर",
      stacksLayerDesc: "भविष्य के शोध-प्रमाण, sBTC प्रोत्साहन, और Stacks पर Clarity स्मार्ट-कॉन्ट्रैक्ट एकीकरण के लिए डिज़ाइन किया गया।",
      create: "बनाएं",
      dashboard: "डैशबोर्ड",
      about: "के बारे में",
      signIn: "साइन इन करें",
      signOut: "साइन आउट करें",
      newThesis: "नई थीसिस",
      myLibrary: "मेरी शोध लाइब्रेरी",
      manageDrafts: "अपने सहेजे गए थीसिस ड्राफ्ट और शोध कार्य का प्रबंधन करें।",
      noSavedFound: "कोई सहेजी गई थीसिस नहीं मिली",
      startGenerating: "एक थीसिस बनाना शुरू करें और इसे अपनी व्यक्तिगत लाइब्रेरी में यहाँ देखने के लिए सहेजें।",
      initiate: "जनरेशन शुरू करें",
      openDraft: "ड्राफ्ट खोलें",
      saveDraft: "ड्राफ्ट सहेजें",
      exportPptx: "PPTX निर्यात करें",
      exportPdf: "PDF निर्यात करें",
      regenerate: "अध्याय पुनः बनाएं",
      aboutTitle: "ThesisAI के बारे में",
      aboutDesc: "ThesisAI एक Stacks-संरेखित स्वायत्त शोध कार्यक्षेत्र है जो उपयोगकर्ता द्वारा प्रदान किए गए स्रोतों को संरचित अकादमिक ड्राफ्ट में बदलता है, साथ ही Stacks-सुरक्षित इंफ्रास्ट्रक्चर पर सत्यापन योग्य दस्तावेज़ उद्गम के लिए उत्पाद तैयार करता है।",
      disclaimerTitle: "अस्वीकरण और नैतिकता",
      disclaimerDesc: "यह उपकरण एक AI सहायक है। AI मतिभ्रम कर सकता है या गलत जानकारी उत्पन्न कर सकता है। हमेशा तथ्यों और उद्धरणों की पुष्टि करें। ThesisAI का उद्देश्य आलोचनात्मक सोच में सहायता करना है, उसे प्रतिस्थापित करना नहीं। जिम्मेदारी से उपयोग करें और अपने संस्थान के अकादमिक अखंडता दिशानिर्देशों का पालन करें।",
      donationTitle: "इस प्रोजेक्ट का समर्थन करें",
      donationDesc: "यह प्रोजेक्ट दुनिया भर के छात्रों की मदद के लिए स्वतंत्र रूप से विकसित किया गया है। यदि आपको यह सहायक लगता है, तो इसके रखरखाव और आगे के विकास का समर्थन करने पर विचार करें।",
      languageName: "हिन्दी",
      saveConfirmation: "थीसिस सफलतापूर्वक सहेजी गई!",
      loginRequirement: "अपनी प्रगति सहेजने के लिए कृपया पहले साइन इन करें।",
      revertConfirmation: "क्या आप वाकई इस संस्करण पर वापस जाना चाहते हैं? वर्तमान दृश्य में कोई भी असहेजे गए परिवर्तन खो जाएंगे।",
      step1Title: "ज्ञान आधार",
      step1Desc: "AI के शोध को निर्देशित करने के लिए PDF अपलोड करें, URL पेस्ट करें, या कच्चा टेक्स्ट दर्ज करें।",
      addUrl: "URL जोड़ें",
      pasteText: "टेक्स्ट पेस्ट करें",
      configureTitle: "आउटपुट को परिष्कृत करें",
      major: "अकादमिक विषय",
      thesisLevel: "थीसिस स्तर",
      writingStyle: "लेखन शैली",
      citationStyle: "उद्धरण शैली",
      generateFull: "पूर्ण थीसिस बनाएं",
      processing: "प्रोसेसिंग हो रही है...",
      thesisTitle: "थीसिस शीर्षक (वैकल्पिक)",
      titlePlaceholder: "AI को तय करने दें या अपना खुद का टाइप करें...",
      generateTitles: "स्रोतों से शीर्षक विकल्प बनाएं",
      antiPlagiarismDesc: "समानता स्कोर को कम करने के लिए स्वाभाविक रूप से पुनर्लेखन करता है।",
      language: "लक्ष्य भाषा",
      contentLength: "सामग्री की लंबाई",
      fontProfile: "फ़ॉन्ट प्रोफ़ाइल",
      antiPlagiarism: "साहित्यिक चोरी विरोधी",
      ctaBadge: "थीसिस के लिए तैयार",
      ctaTitle: "अकादमिक-स्तर का आउटपुट, अगला ऑन-चेन शोध उद्गम।",
      ctaDesc: "Stacks रोडमैप: Clarity के साथ अंतिम दस्तावेज़ हैश को एंकर करें, समीक्षक बैज जारी करें, और शोध उद्गम के विकसित होने के साथ योगदानकर्ताओं के लिए sBTC-संरेखित प्रोत्साहन जोड़ें।",
      ctaButton: "अभी लिखना शुरू करें",
      walletGuideTitle: "अपना वॉलेट कैसे कनेक्ट करें",
      walletGuideDesc: "अपना $THESIS बैलेंस जांचने और ऑन-चेन अपना थीसिस सर्टिफिकेट मिंट करने के लिए अपना Stacks वॉलेट कनेक्ट करें।",
      walletGuideStep1: "अपने ब्राउज़र में Leather या Xverse वॉलेट एक्सटेंशन इंस्टॉल करें",
      walletGuideStep2: "शीर्ष नेविगेशन में \"Connect Stacks\" बटन पर क्लिक करें",
      walletGuideStep3: "अपने वॉलेट पॉपअप में कनेक्शन अनुरोध को स्वीकृत करें",
      walletGuideStep4: "आपका $THESIS बैलेंस स्वचालित रूप से दिखाई देगा",
      walletGuideMobile: "मोबाइल पर, वॉलेट एक्सेस के लिए इस साइट को Leather या Xverse इन-ऐप ब्राउज़र के भीतर खोलें।",
      walletGuideLeather: "Leather वॉलेट प्राप्त करें",
      walletGuideXverse: "Xverse वॉलेट प्राप्त करें",
      walletGuideLoginTitle: "अपने डैशबोर्ड तक पहुंचने के लिए साइन इन करें",
      walletGuideLoginDesc: "अपने थीसिस ड्राफ्ट सहेजने, जनरेशन इतिहास देखने, और सभी डिवाइसों पर अपनी शोध लाइब्रेरी का प्रबंधन करने के लिए Google से साइन इन करें।",
      walletGuideLoginBtn: "Google से साइन इन करें",
      walletGuideOrHold: "या 1,000 $THESIS टोकन रखें",
      stakeTitle: "पूर्ण एक्सेस अनलॉक करें",
      stakeDesc: "अपने कनेक्टेड वॉलेट में 1,000 $THESIS टोकन रखकर ThesisAI की सभी सुविधाओं को अनलॉक करें।",
      stakeOption1: "1,000 $THESIS रखें",
      stakeOption1Desc: "सभी सुविधाओं को स्थायी रूप से अनलॉक करने के लिए अपने कनेक्टेड Stacks वॉलेट में कम से कम 1,000 $THESIS टोकन रखें।",
      stakeCheckBalance: "मेरा $THESIS बैलेंस जांचें",

      saveUnlimitedDrafts: "अपनी लाइब्रेरी में असीमित थीसिस ड्राफ्ट सहेजें",
      accessGenHistory: "जनरेशन इतिहास और संशोधनों तक पहुंचें",
      syncDevices: "सभी डिवाइसों में स्वचालित रूप से सिंक करें",
      viewCertificates: "मिंट किए गए सर्टिफिकेट देखें और प्रबंधित करें",
      signedInAsPrefix: "इस रूप में साइन इन किया गया",
      accessGate: "एक्सेस गेट",
      activeNow: "अभी सक्रिय",
      connectWalletBtn: "वॉलेट कनेक्ट करें",
      communityTraction: "समुदाय की सहभागिता",
      researchersGenerating: "शोधकर्ता पहले से ही जनरेट कर रहे हैं।",
      thesesGenerated: "थीसिस जनरेट की गईं",
      latestBarLive: "नवीनतम बार लाइव ऑन-चेन डेटा है",
      monthsActive: "सक्रिय महीने",
      exportFormatsLabel: "निर्यात प्रारूप",
      revisionsLabel: "संशोधन",
    },
    fa: {
      tagline: "عامل پژوهش خودکار",
      heroBadge: "هوش آکادمیک مبتنی بر Stacks",
      heroTitle: "منابع پژوهشی را به یک فضای کاری پایان‌نامه منظم تبدیل کنید.",
      heroDesc: "ThesisAI هوش مصنوعی با سرعت Groq، نگارش آگاه به استناد، ابزارهای خروجی، و نقشه راه لایه اثبات ایمن‌شده با Stacks را ترکیب می‌کند تا دانشجویان بتوانند بدون سردرگمی از منابع خام به کار آکادمیک ساختاریافته برسند.",
      launchStudio: "راه‌اندازی استودیوی پژوهش",
      connectStacks: "بررسی لایه Stacks",
      stacksNote: "ساخته شده با نقشه راه امنیتی در سطح Stacks: اصالت پژوهش قابل تأیید، اثبات هش سند، و اعتبارسنجی آینده روی زنجیره — بدون مختل کردن روند نگارش شما.",
      aiModels: "شبکه مدل‌های هوش مصنوعی Groq",
      aiModelsDesc: "وظایف پژوهشی را از طریق Llama 3.3 70B، Qwen3 32B، DeepSeek R1 Distill، و مدل‌های پشتیبان سریع از سرور هدایت می‌کند.",
      sourceIngestion: "دریافت منابع",
      sourceIngestionDesc: "پیش از تولید محتوا، URL اضافه کنید، متن بچسبانید، یا اسناد PDF/TXT/MD را به‌عنوان پایگاه دانش هدایت‌شده بارگذاری کنید.",
      thesisWorkflow: "گردش کار پایان‌نامه",
      thesisWorkflowDesc: "عنوان‌ها، ساختارها، فصل‌ها، منابع، بازنگری‌ها، و خروجی‌ها را در یک فضای کاری روان و واکنش‌گرا تولید کنید.",
      stacksLayer: "لایه اثبات Stacks",
      stacksLayerDesc: "طراحی‌شده برای اثبات پژوهش آینده، مزایای sBTC، و یکپارچه‌سازی قرارداد هوشمند Clarity روی Stacks.",
      create: "ایجاد",
      dashboard: "داشبورد",
      about: "درباره",
      signIn: "ورود",
      signOut: "خروج",
      newThesis: "پایان‌نامه جدید",
      myLibrary: "کتابخانه پژوهشی من",
      manageDrafts: "پیش‌نویس‌های پایان‌نامه ذخیره‌شده و کارهای پژوهشی خود را مدیریت کنید.",
      noSavedFound: "هیچ پایان‌نامه ذخیره‌شده‌ای یافت نشد",
      startGenerating: "تولید یک پایان‌نامه را شروع کنید و آن را ذخیره کنید تا اینجا در کتابخانه شخصی خود ببینید.",
      initiate: "شروع تولید",
      openDraft: "باز کردن پیش‌نویس",
      saveDraft: "ذخیره پیش‌نویس",
      exportPptx: "خروجی PPTX",
      exportPdf: "خروجی PDF",
      regenerate: "بازتولید فصل",
      aboutTitle: "درباره ThesisAI",
      aboutDesc: "ThesisAI یک فضای کاری پژوهشی خودکار همسو با Stacks است که منابع ارائه‌شده توسط کاربر را به پیش‌نویس‌های آکادمیک ساختاریافته تبدیل می‌کند، و در عین حال محصول را برای اصالت سند قابل تأیید روی زیرساخت ایمن‌شده با Stacks آماده می‌کند.",
      disclaimerTitle: "اعلام مسئولیت و اخلاق",
      disclaimerDesc: "این ابزار یک دستیار هوش مصنوعی است. هوش مصنوعی ممکن است توهم بزند یا اطلاعات نادرست تولید کند. همیشه واقعیت‌ها و استنادها را تأیید کنید. ThesisAI برای کمک طراحی شده، نه جایگزینی تفکر انتقادی. مسئولانه استفاده کنید و از دستورالعمل‌های صداقت آکادمیک مؤسسه خود پیروی کنید.",
      donationTitle: "از این پروژه حمایت کنید",
      donationDesc: "این پروژه به‌طور مستقل برای کمک به دانشجویان در سراسر جهان توسعه یافته است. اگر آن را مفید می‌دانید، حمایت از نگهداری و توسعه بیشتر آن را در نظر بگیرید.",
      languageName: "فارسی",
      saveConfirmation: "پایان‌نامه با موفقیت ذخیره شد!",
      loginRequirement: "لطفاً ابتدا برای ذخیره پیشرفت خود وارد شوید.",
      revertConfirmation: "آیا مطمئن هستید که می‌خواهید به این نسخه بازگردید؟ هرگونه تغییر ذخیره‌نشده در نمای فعلی از بین خواهد رفت.",
      step1Title: "پایگاه دانش",
      step1Desc: "برای هدایت پژوهش هوش مصنوعی، فایل PDF بارگذاری کنید، URL بچسبانید، یا متن خام وارد کنید.",
      addUrl: "افزودن URL",
      pasteText: "چسباندن متن",
      configureTitle: "بهبود خروجی",
      major: "رشته آکادمیک",
      thesisLevel: "سطح پایان‌نامه",
      writingStyle: "سبک نگارش",
      citationStyle: "سبک استناد",
      generateFull: "تولید پایان‌نامه کامل",
      processing: "در حال پردازش...",
      thesisTitle: "عنوان پایان‌نامه (اختیاری)",
      titlePlaceholder: "اجازه دهید هوش مصنوعی تصمیم بگیرد یا عنوان خود را تایپ کنید...",
      generateTitles: "تولید گزینه‌های عنوان از منابع",
      antiPlagiarismDesc: "به‌طور طبیعی بازنویسی می‌کند تا امتیاز شباهت را کاهش دهد.",
      language: "زبان هدف",
      contentLength: "طول محتوا",
      fontProfile: "پروفایل فونت",
      antiPlagiarism: "ضد سرقت ادبی",
      ctaBadge: "آماده برای پایان‌نامه",
      ctaTitle: "خروجی در سطح آکادمیک، اصالت پژوهش روی زنجیره در ادامه.",
      ctaDesc: "نقشه راه Stacks: تثبیت هش اسناد نهایی با Clarity، صدور نشان داوران، و افزودن مزایای همسو با sBTC برای مشارکت‌کنندگان با تحول اصالت پژوهش.",
      ctaButton: "همین حالا نوشتن را شروع کنید",
      walletGuideTitle: "نحوه اتصال کیف پول شما",
      walletGuideDesc: "کیف پول Stacks خود را متصل کنید تا موجودی $THESIS خود را بررسی کرده و گواهی پایان‌نامه خود را روی زنجیره ضرب کنید.",
      walletGuideStep1: "افزونه کیف پول Leather یا Xverse را در مرورگر خود نصب کنید",
      walletGuideStep2: "روی دکمه \"Connect Stacks\" در نوار ناوبری بالا کلیک کنید",
      walletGuideStep3: "درخواست اتصال را در پاپ‌آپ کیف پول خود تأیید کنید",
      walletGuideStep4: "موجودی $THESIS شما به‌طور خودکار نمایش داده می‌شود",
      walletGuideMobile: "در موبایل، این سایت را در مرورگر داخلی Leather یا Xverse برای دسترسی به کیف پول باز کنید.",
      walletGuideLeather: "دریافت کیف پول Leather",
      walletGuideXverse: "دریافت کیف پول Xverse",
      walletGuideLoginTitle: "برای دسترسی به داشبورد خود وارد شوید",
      walletGuideLoginDesc: "با Google وارد شوید تا پیش‌نویس‌های پایان‌نامه خود را ذخیره کنید، تاریخچه تولید را مشاهده کنید، و کتابخانه پژوهشی خود را در همه دستگاه‌ها مدیریت کنید.",
      walletGuideLoginBtn: "ورود با Google",
      walletGuideOrHold: "یا 1,000 توکن $THESIS نگه دارید",
      stakeTitle: "باز کردن دسترسی کامل",
      stakeDesc: "با نگه‌داشتن 1,000 توکن $THESIS در کیف پول متصل خود، تمام ویژگی‌های ThesisAI را باز کنید.",
      stakeOption1: "نگه‌داشتن 1,000 $THESIS",
      stakeOption1Desc: "حداقل 1,000 توکن $THESIS را در کیف پول Stacks متصل خود نگه دارید تا تمام ویژگی‌ها را به‌طور دائمی باز کنید.",
      stakeCheckBalance: "بررسی موجودی $THESIS من",

      saveUnlimitedDrafts: "پیش‌نویس‌های پایان‌نامه نامحدود را در کتابخانه خود ذخیره کنید",
      accessGenHistory: "دسترسی به تاریخچه تولید و بازنگری‌ها",
      syncDevices: "همگام‌سازی خودکار بین دستگاه‌ها",
      viewCertificates: "مشاهده و مدیریت گواهی‌های صادرشده",
      signedInAsPrefix: "وارد شده به‌عنوان",
      accessGate: "دروازه دسترسی",
      activeNow: "اکنون فعال",
      connectWalletBtn: "اتصال کیف پول",
      communityTraction: "تعامل جامعه",
      researchersGenerating: "پژوهشگران در حال تولید محتوا هستند.",
      thesesGenerated: "پایان‌نامه‌های تولیدشده",
      latestBarLive: "آخرین ستون داده زنده روی زنجیره است",
      monthsActive: "ماه‌های فعالیت",
      exportFormatsLabel: "فرمت‌های خروجی",
      revisionsLabel: "بازنگری‌ها",
    },
    ja: {
      tagline: "自律研究エージェント",
      heroBadge: "Stacks搭載のアカデミックインテリジェンス",
      heroTitle: "研究資料を洗練された論文ワークスペースに変換します。",
      heroDesc: "ThesisAIはGroqの速度のAI、引用を意識した執筆、エクスポートツール、そしてStacksで保護された証明レイヤーのロードマップを組み合わせ、学生が生の資料から構造化された学術的成果へ迷うことなく進めるようにします。",
      launchStudio: "リサーチスタジオを起動",
      connectStacks: "Stacksレイヤーを探る",
      stacksNote: "Stacksグレードのセキュリティロードマップを念頭に構築: 検証可能な研究の出所、文書ハッシュの証明、将来のオンチェーン検証 — あなたの執筆フローを妨げることなく。",
      aiModels: "Groq AIモデルメッシュ",
      aiModelsDesc: "Llama 3.3 70B、Qwen3 32B、DeepSeek R1 Distill、サーバーからの高速フォールバックモデル間で研究タスクをルーティングします。",
      sourceIngestion: "ソースの取り込み",
      sourceIngestionDesc: "生成前にURLを追加、テキストを貼り付け、またはPDF/TXT/MD文書をガイド付き知識ベースとしてアップロードします。",
      thesisWorkflow: "論文ワークフロー",
      thesisWorkflowDesc: "1つのスムーズでレスポンシブなワークスペースでタイトル、構造、章、参考文献、改訂、エクスポートを生成します。",
      stacksLayer: "Stacks証明レイヤー",
      stacksLayerDesc: "将来の研究証明、sBTCインセンティブ、Stacks上のClarityスマートコントラクト統合のために設計されています。",
      create: "作成",
      dashboard: "ダッシュボード",
      about: "概要",
      signIn: "サインイン",
      signOut: "サインアウト",
      newThesis: "新しい論文",
      myLibrary: "マイ研究ライブラリ",
      manageDrafts: "保存した論文の草稿と研究作業を管理します。",
      noSavedFound: "保存された論文が見つかりません",
      startGenerating: "論文の生成を開始し、保存してパーソナルライブラリでここに表示します。",
      initiate: "生成を開始",
      openDraft: "草稿を開く",
      saveDraft: "草稿を保存",
      exportPptx: "PPTXをエクスポート",
      exportPdf: "PDFをエクスポート",
      regenerate: "章を再生成",
      aboutTitle: "ThesisAIについて",
      aboutDesc: "ThesisAIはStacksに適合した自律研究ワークスペースであり、ユーザー提供のソースを構造化された学術草稿に変換しながら、Stacksで保護されたインフラ上での検証可能な文書の出所のために製品を準備します。",
      disclaimerTitle: "免責事項と倫理",
      disclaimerDesc: "このツールはAIアシスタントです。AIは幻覚を起こしたり不正確な情報を生成したりする可能性があります。常に事実と引用を確認してください。ThesisAIは批判的思考を置き換えるものではなく、支援することを目的としています。責任を持って使用し、所属機関の学術的誠実性のガイドラインに従ってください。",
      donationTitle: "このプロジェクトを支援する",
      donationDesc: "このプロジェクトは世界中の学生を支援するために独立して開発されています。役立つと感じた場合は、メンテナンスと今後の開発を支援することをご検討ください。",
      languageName: "日本語",
      saveConfirmation: "論文が正常に保存されました！",
      loginRequirement: "進行状況を保存するには、まずサインインしてください。",
      revertConfirmation: "このバージョンに戻してもよろしいですか？現在のビューの未保存の変更は失われます。",
      step1Title: "ナレッジベース",
      step1Desc: "PDFをアップロード、URLを貼り付け、または生のテキストを入力してAIの研究をガイドします。",
      addUrl: "URLを追加",
      pasteText: "テキストを貼り付け",
      configureTitle: "出力を調整",
      major: "専攻分野",
      thesisLevel: "論文レベル",
      writingStyle: "文体",
      citationStyle: "引用形式",
      generateFull: "完全な論文を生成",
      processing: "処理中...",
      thesisTitle: "論文タイトル（任意）",
      titlePlaceholder: "AIに決めさせるか、自分で入力してください...",
      generateTitles: "ソースからタイトルの選択肢を生成",
      antiPlagiarismDesc: "類似度スコアを下げるために自然にパラフレーズします。",
      language: "対象言語",
      contentLength: "コンテンツの長さ",
      fontProfile: "フォントプロファイル",
      antiPlagiarism: "盗作防止",
      ctaBadge: "論文準備完了",
      ctaTitle: "学術レベルの出力、次はオンチェーンの研究出所。",
      ctaDesc: "Stacksロードマップ: Clarityで最終文書ハッシュを固定し、レビュアーバッジを発行し、研究の出所が進化するにつれて貢献者にsBTCに連動したインセンティブを追加します。",
      ctaButton: "今すぐ書き始める",
      walletGuideTitle: "ウォレットの接続方法",
      walletGuideDesc: "Stacksウォレットを接続して$THESISの残高を確認し、論文証明書をオンチェーンで発行します。",
      walletGuideStep1: "ブラウザにLeatherまたはXverseウォレット拡張機能をインストールします",
      walletGuideStep2: "上部のナビゲーションで「Connect Stacks」ボタンをクリックします",
      walletGuideStep3: "ウォレットのポップアップで接続リクエストを承認します",
      walletGuideStep4: "$THESISの残高が自動的に表示されます",
      walletGuideMobile: "モバイルでは、ウォレットアクセスのためにLeatherまたはXverseのアプリ内ブラウザでこのサイトを開いてください。",
      walletGuideLeather: "Leatherウォレットを取得",
      walletGuideXverse: "Xverseウォレットを取得",
      walletGuideLoginTitle: "ダッシュボードにアクセスするにはサインインしてください",
      walletGuideLoginDesc: "Googleでサインインして論文の草稿を保存し、生成履歴を表示し、すべてのデバイスで研究ライブラリを管理します。",
      walletGuideLoginBtn: "Googleでサインイン",
      walletGuideOrHold: "または1,000 $THESISトークンを保持",
      stakeTitle: "フルアクセスをアンロック",
      stakeDesc: "接続されたウォレットに1,000 $THESISトークンを保持してThesisAIのすべての機能をアンロックします。",
      stakeOption1: "1,000 $THESISを保持",
      stakeOption1Desc: "接続されたStacksウォレットに最低1,000 $THESISトークンを保持して、すべての機能を永続的にアンロックします。",
      stakeCheckBalance: "$THESIS残高を確認",

      saveUnlimitedDrafts: "無制限の論文草稿をライブラリに保存",
      accessGenHistory: "生成履歴と改訂版にアクセス",
      syncDevices: "デバイス間で自動的に同期",
      viewCertificates: "発行された証明書の表示と管理",
      signedInAsPrefix: "サインイン中:",
      accessGate: "アクセスゲート",
      activeNow: "現在アクティブ",
      connectWalletBtn: "ウォレットを接続",
      communityTraction: "コミュニティの活動",
      researchersGenerating: "研究者は既に生成しています。",
      thesesGenerated: "生成された論文",
      latestBarLive: "最新のバーはライブのオンチェーンデータです",
      monthsActive: "活動月数",
      exportFormatsLabel: "エクスポート形式",
      revisionsLabel: "改訂",
    },
    ko: {
      tagline: "자율 연구 에이전트",
      heroBadge: "Stacks 기반 학술 인텔리전스",
      heroTitle: "연구 자료를 완성도 높은 논문 작업 공간으로 변환하세요.",
      heroDesc: "ThesisAI는 Groq 속도의 AI, 인용을 인식하는 작성, 내보내기 도구, 그리고 Stacks로 보호되는 증명 계층 로드맵을 결합하여 학생들이 원본 자료에서 구조화된 학술 작업으로 헤매지 않고 나아갈 수 있도록 합니다.",
      launchStudio: "연구 스튜디오 시작",
      connectStacks: "Stacks 계층 탐색",
      stacksNote: "Stacks급 보안 로드맵을 염두에 두고 구축: 검증 가능한 연구 출처, 문서 해시 증명, 그리고 미래의 온체인 검증 — 작성 흐름을 방해하지 않습니다.",
      aiModels: "Groq AI 모델 메시",
      aiModelsDesc: "서버의 Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill 및 빠른 백업 모델 간에 연구 작업을 라우팅합니다.",
      sourceIngestion: "소스 수집",
      sourceIngestionDesc: "생성 전에 URL을 추가하거나, 텍스트를 붙여넣거나, PDF/TXT/MD 문서를 안내된 지식 기반으로 업로드하세요.",
      thesisWorkflow: "논문 워크플로우",
      thesisWorkflowDesc: "하나의 매끄럽고 반응성 좋은 작업 공간에서 제목, 구조, 챕터, 참고문헌, 수정 사항, 내보내기를 생성합니다.",
      stacksLayer: "Stacks 증명 계층",
      stacksLayerDesc: "미래의 연구 증명, sBTC 인센티브, 그리고 Stacks의 Clarity 스마트 컨트랙트 통합을 위해 설계되었습니다.",
      create: "생성",
      dashboard: "대시보드",
      about: "소개",
      signIn: "로그인",
      signOut: "로그아웃",
      newThesis: "새 논문",
      myLibrary: "내 연구 라이브러리",
      manageDrafts: "저장된 논문 초안과 연구 작업을 관리하세요.",
      noSavedFound: "저장된 논문을 찾을 수 없습니다",
      startGenerating: "논문 생성을 시작하고 저장하여 개인 라이브러리에서 확인하세요.",
      initiate: "생성 시작",
      openDraft: "초안 열기",
      saveDraft: "초안 저장",
      exportPptx: "PPTX 내보내기",
      exportPdf: "PDF 내보내기",
      regenerate: "챕터 재생성",
      aboutTitle: "ThesisAI 소개",
      aboutDesc: "ThesisAI는 Stacks에 부합하는 자율 연구 작업 공간으로, 사용자가 제공한 자료를 구조화된 학술 초안으로 변환하면서 Stacks로 보호되는 인프라에서 검증 가능한 문서 출처를 위한 제품을 준비합니다.",
      disclaimerTitle: "면책 조항 및 윤리",
      disclaimerDesc: "이 도구는 AI 어시스턴트입니다. AI는 환각을 일으키거나 부정확한 정보를 생성할 수 있습니다. 항상 사실과 인용을 확인하세요. ThesisAI는 비판적 사고를 대체하는 것이 아니라 돕는 것을 목표로 합니다. 책임감 있게 사용하고 소속 기관의 학술 윤리 가이드라인을 준수하세요.",
      donationTitle: "이 프로젝트 후원하기",
      donationDesc: "이 프로젝트는 전 세계 학생들을 돕기 위해 독립적으로 개발되었습니다. 도움이 되었다면 유지 관리와 추가 개발을 후원하는 것을 고려해 주세요.",
      languageName: "한국어",
      saveConfirmation: "논문이 성공적으로 저장되었습니다!",
      loginRequirement: "진행 상황을 저장하려면 먼저 로그인하세요.",
      revertConfirmation: "이 버전으로 되돌리시겠습니까? 현재 보기에서 저장되지 않은 변경 사항은 모두 사라집니다.",
      step1Title: "지식 기반",
      step1Desc: "AI의 연구를 안내하기 위해 PDF를 업로드하거나, URL을 붙여넣거나, 원본 텍스트를 입력하세요.",
      addUrl: "URL 추가",
      pasteText: "텍스트 붙여넣기",
      configureTitle: "출력 다듬기",
      major: "학업 전공",
      thesisLevel: "논문 수준",
      writingStyle: "작문 스타일",
      citationStyle: "인용 스타일",
      generateFull: "전체 논문 생성",
      processing: "처리 중...",
      thesisTitle: "논문 제목 (선택사항)",
      titlePlaceholder: "AI가 결정하도록 하거나 직접 입력하세요...",
      generateTitles: "소스에서 제목 옵션 생성",
      antiPlagiarismDesc: "유사도 점수를 줄이기 위해 자연스럽게 의역합니다.",
      language: "목표 언어",
      contentLength: "콘텐츠 길이",
      fontProfile: "폰트 프로필",
      antiPlagiarism: "표절 방지",
      ctaBadge: "논문 준비 완료",
      ctaTitle: "학술 수준의 결과물, 다음은 온체인 연구 출처입니다.",
      ctaDesc: "Stacks 로드맵: Clarity로 최종 문서 해시를 고정하고, 검토자 배지를 발급하며, 연구 출처가 발전함에 따라 기여자를 위한 sBTC 연계 인센티브를 추가합니다.",
      ctaButton: "지금 작성 시작하기",
      walletGuideTitle: "지갑 연결 방법",
      walletGuideDesc: "Stacks 지갑을 연결하여 $THESIS 잔액을 확인하고 온체인에서 논문 인증서를 발행하세요.",
      walletGuideStep1: "브라우저에 Leather 또는 Xverse 지갑 확장 프로그램을 설치하세요",
      walletGuideStep2: "상단 내비게이션에서 \"Connect Stacks\" 버튼을 클릭하세요",
      walletGuideStep3: "지갑 팝업에서 연결 요청을 승인하세요",
      walletGuideStep4: "$THESIS 잔액이 자동으로 표시됩니다",
      walletGuideMobile: "모바일에서는 지갑 액세스를 위해 Leather 또는 Xverse 인앱 브라우저에서 이 사이트를 여세요.",
      walletGuideLeather: "Leather 지갑 받기",
      walletGuideXverse: "Xverse 지갑 받기",
      walletGuideLoginTitle: "대시보드에 액세스하려면 로그인하세요",
      walletGuideLoginDesc: "Google로 로그인하여 논문 초안을 저장하고, 생성 기록을 확인하고, 모든 기기에서 연구 라이브러리를 관리하세요.",
      walletGuideLoginBtn: "Google로 로그인",
      walletGuideOrHold: "또는 1,000 $THESIS 토큰 보유",
      stakeTitle: "전체 액세스 잠금 해제",
      stakeDesc: "연결된 지갑에 1,000 $THESIS 토큰을 보유하여 ThesisAI의 모든 기능을 잠금 해제하세요.",
      stakeOption1: "1,000 $THESIS 보유",
      stakeOption1Desc: "모든 기능을 영구적으로 잠금 해제하려면 연결된 Stacks 지갑에 최소 1,000 $THESIS 토큰을 보유하세요.",
      stakeCheckBalance: "내 $THESIS 잔액 확인",

      saveUnlimitedDrafts: "무제한 논문 초안을 라이브러리에 저장",
      accessGenHistory: "생성 기록 및 수정 사항 액세스",
      syncDevices: "기기 간 자동 동기화",
      viewCertificates: "발행된 인증서 보기 및 관리",
      signedInAsPrefix: "다음으로 로그인됨:",
      accessGate: "액세스 게이트",
      activeNow: "현재 활성화됨",
      connectWalletBtn: "지갑 연결",
      communityTraction: "커뮤니티 참여도",
      researchersGenerating: "연구자들이 이미 생성하고 있습니다.",
      thesesGenerated: "생성된 논문",
      latestBarLive: "최신 막대는 실시간 온체인 데이터입니다",
      monthsActive: "활동 월수",
      exportFormatsLabel: "내보내기 형식",
      revisionsLabel: "수정 사항",
    },
    ha: {
      tagline: "Wakilin Bincike Mai Cin Gashin Kansa",
      heroBadge: "Hazaka ta ilimi mai ƴar Stacks",
      heroTitle: "Mayar da hanyoyin bincike zuwa wurin aiki na kasidar da aka shafe.",
      heroDesc: "ThesisAI yana haɗa AI mai saurin Groq, rubutu mai sanin ambato, kayan aikin fitarwa, da tsarin shimfidar tabbaci wanda Stacks ya kiyaye domin ɗalibai su iya tafiya daga hanyoyin danye zuwa aikin ilimi mai tsari ba tare da ɓacewa ba.",
      launchStudio: "Kaddamar da Sitiyo na Bincike",
      connectStacks: "Bincika Shimfidar Stacks",
      stacksNote: "An gina shi tare da tsarin tsaro na matakin Stacks: tushen bincike mai tabbatuwa, tabbacin hash na takardu, da tabbatarwa ta gaba akan sarkar — ba tare da tsoma baki cikin tsarin rubutunka ba.",
      aiModels: "Hanyar Sadarwar Samfurin Groq AI",
      aiModelsDesc: "Yana jagorantar ayyukan bincike ta hanyar Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, da samfuran madadi masu sauri daga sabar.",
      sourceIngestion: "Karɓar Hanyoyi",
      sourceIngestionDesc: "Ƙara URL, manna rubutu, ko loda takardu na PDF/TXT/MD a matsayin tushen ilimi mai jagora kafin ƙirƙira.",
      thesisWorkflow: "Tsarin Aikin Kasida",
      thesisWorkflowDesc: "Ƙirƙiri taken, tsari, surori, nassoshi, gyare-gyare, da fitarwa a wurin aiki mai santsi da amsa.",
      stacksLayer: "Shimfidar Tabbaci ta Stacks",
      stacksLayerDesc: "An tsara shi don tabbacin bincike na gaba, ƙarfafawar sBTC, da haɗin kwangilar wayo ta Clarity akan Stacks.",
      create: "Ƙirƙira",
      dashboard: "Dashboard",
      about: "Game da",
      signIn: "Shiga",
      signOut: "Fita",
      newThesis: "Sabuwar Kasida",
      myLibrary: "Laburaren Bincikena",
      manageDrafts: "Sarrafa zayyanan kasidarku da aikin bincike da aka ajiye.",
      noSavedFound: "Babu Kasidar da Aka Ajiye da Aka Samu",
      startGenerating: "Fara ƙirƙirar kasida kuma ajiye ta don ganin ta a nan a laburaren ka na sirri.",
      initiate: "Fara Ƙirƙira",
      openDraft: "Buɗe Zayyana",
      saveDraft: "Ajiye Zayyana",
      exportPptx: "Fitar da PPTX",
      exportPdf: "Fitar da PDF",
      regenerate: "Sake Ƙirƙirar Sura",
      aboutTitle: "Game da ThesisAI",
      aboutDesc: "ThesisAI wurin aiki na bincike mai cin gashin kansa ne wanda ya yi daidai da Stacks wanda yake mayar da hanyoyin da mai amfani ya bayar zuwa zayyanan ilimi mai tsari, yayin da yake shirya samfurin don tushen takardu mai tabbatuwa akan tsarin da Stacks ya kiyaye.",
      disclaimerTitle: "Sanarwa & Da'a",
      disclaimerDesc: "Wannan kayan aiki mataimaki ne na AI. AI na iya ɓatawa ko samar da bayanai marasa daidai. Koyaushe tabbatar da gaskiya da ambato. ThesisAI na nufin taimakawa, ba maye gurbin tunani mai zurfi ba. Yi amfani da shi cikin nauyi kuma bi ka'idojin gaskiya na ilimi na hukumarku.",
      donationTitle: "Goyi Bayan Wannan Aikin",
      donationDesc: "An ƙirƙiri wannan aikin ba tare da dogaro da wani ba domin taimakon ɗalibai a duniya. Idan ka ga yana taimakawa, ka yi la'akari da goyon bayan kiyaye shi da ci gaba da haɓaka shi.",
      languageName: "Hausa",
      saveConfirmation: "An ajiye kasida cikin nasara!",
      loginRequirement: "Da fatan za a shiga tukuna domin ajiye ci gaban ka.",
      revertConfirmation: "Ka tabbata kana son komawa zuwa wannan sigar? Duk wani canji da ba a ajiye ba a wannan kallon zai ɓace.",
      step1Title: "Tushen Ilimi",
      step1Desc: "Loda PDF, manna URL, ko shigar da rubutu danye don jagorantar binciken AI.",
      addUrl: "Ƙara URL",
      pasteText: "Manna Rubutu",
      configureTitle: "Inganta Sakamako",
      major: "Sashen Ilimi",
      thesisLevel: "Matakin Kasida",
      writingStyle: "Salon Rubutu",
      citationStyle: "Salon Ambato",
      generateFull: "Ƙirƙiri Cikakkiyar Kasida",
      processing: "Ana sarrafawa...",
      thesisTitle: "Taken Kasida (Na Zaɓi)",
      titlePlaceholder: "Bari AI ya yanke shawara ko ka rubuta naka...",
      generateTitles: "Ƙirƙiri Zaɓuɓɓukan Take daga hanyoyi",
      antiPlagiarismDesc: "Yana sake fasalin rubutu ta hanyar dabi'a don rage maki kamanceceniya.",
      language: "Harshen Manufa",
      contentLength: "Tsawon Abun Ciki",
      fontProfile: "Bayanin Font",
      antiPlagiarism: "Anti-Sata Ilimi",
      ctaBadge: "A Shirye don Kasida",
      ctaTitle: "Sakamako na matakin ilimi, tushen bincike akan sarkar na gaba.",
      ctaDesc: "Tsarin Stacks: ɗora hash na takardu na ƙarshe da Clarity, bayar da bajojin masu duba, da ƙara ƙarfafawa da suka yi daidai da sBTC ga masu bayar da gudunmawa yayin da tushen bincike ke haɓaka.",
      ctaButton: "Fara Rubutu Yanzu",
      walletGuideTitle: "Yadda Za a Haɗa Walat Ɗinka",
      walletGuideDesc: "Haɗa walat ɗinka na Stacks don duba ma'aunin $THESIS ɗinka da ƙirƙirar Takardar Shaidar Kasidarka akan sarkar.",
      walletGuideStep1: "Saka ƙarin walat na Leather ko Xverse a cikin burauzar ɗinka",
      walletGuideStep2: "Danna maɓallin \"Connect Stacks\" a saman kewayawa",
      walletGuideStep3: "Amince da buƙatar haɗi a cikin tsallake-tsallake na walat ɗinka",
      walletGuideStep4: "Ma'aunin $THESIS ɗinka zai bayyana kai tsaye",
      walletGuideMobile: "A wayar hannu, buɗe wannan shafin a cikin burauzar Leather ko Xverse don samun damar walat.",
      walletGuideLeather: "Samu Walat na Leather",
      walletGuideXverse: "Samu Walat na Xverse",
      walletGuideLoginTitle: "Shiga don Samun Damar Dashboard Ɗinka",
      walletGuideLoginDesc: "Shiga da Google don ajiye zayyanan kasidarka, duba tarihin ƙirƙira, da sarrafa laburaren binciken ka a duk na'urori.",
      walletGuideLoginBtn: "Shiga da Google",
      walletGuideOrHold: "Ko riƙe alamomin $THESIS 1,000",
      stakeTitle: "Buɗe Cikakkiyar Damar Shiga",
      stakeDesc: "Buɗe duk fasalulluran ThesisAI ta hanyar riƙe alamomin $THESIS 1,000 a cikin walat ɗinka da aka haɗa.",
      stakeOption1: "Riƙe $THESIS 1,000",
      stakeOption1Desc: "Riƙe aƙalla alamomin $THESIS 1,000 a cikin walat ɗinka na Stacks da aka haɗa don buɗe duk fasaloli har abada.",
      stakeCheckBalance: "Duba Ma'aunin $THESIS Na",

      saveUnlimitedDrafts: "Ajiye zayyanan kasida marasa iyaka a laburaren ka",
      accessGenHistory: "Samun damar tarihin ƙirƙira & gyare-gyare",
      syncDevices: "Daidaita kai tsaye a duk na'urori",
      viewCertificates: "Duba & sarrafa takardun shaida da aka ƙirƙira",
      signedInAsPrefix: "An shiga a matsayin",
      accessGate: "Ƙofar Shiga",
      activeNow: "Mai Aiki Yanzu",
      connectWalletBtn: "Haɗa Walat",
      communityTraction: "Halartar Al'umma",
      researchersGenerating: "Masu bincike suna ƙirƙira tuni.",
      thesesGenerated: "Kasidu da Aka Ƙirƙira",
      latestBarLive: "sandar baya-bayan nan ita ce bayanan kai tsaye akan sarkar",
      monthsActive: "Watanni Masu Aiki",
      exportFormatsLabel: "Tsarin Fitarwa",
      revisionsLabel: "Gyare-gyare",
    },
    sw: {
      tagline: "Wakala wa Utafiti Unaojitegemea",
      heroBadge: "Akili ya kitaaluma inayotumia Stacks",
      heroTitle: "Geuza vyanzo vya utafiti kuwa nafasi ya kazi ya tasnifu iliyokamilika.",
      heroDesc: "ThesisAI inachanganya AI ya kasi ya Groq, uandishi unaozingatia manukuu, zana za kuhamisha, na ramani ya safu ya uthibitisho inayolindwa na Stacks ili wanafunzi waweze kuhama kutoka vyanzo ghafi kwenda kazi ya kitaaluma iliyopangwa bila kupotea.",
      launchStudio: "Zindua Studio ya Utafiti",
      connectStacks: "Chunguza Safu ya Stacks",
      stacksNote: "Imejengwa kwa ramani ya usalama ya kiwango cha Stacks: chanzo cha utafiti kinachoweza kuthibitishwa, uthibitisho wa hashi ya nyaraka, na uthibitishaji wa baadaye kwenye mnyororo — bila kuvuruga mtiririko wako wa uandishi.",
      aiModels: "Mtandao wa Mifano ya AI ya Groq",
      aiModelsDesc: "Inaelekeza kazi za utafiti kupitia Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, na mifano ya akiba ya haraka kutoka kwa seva.",
      sourceIngestion: "Uchukuaji wa Vyanzo",
      sourceIngestionDesc: "Ongeza URL, bandika maandishi, au pakia nyaraka za PDF/TXT/MD kama msingi wa maarifa yenye mwongozo kabla ya kuunda.",
      thesisWorkflow: "Mtiririko wa Kazi wa Tasnifu",
      thesisWorkflowDesc: "Unda vichwa, miundo, sura, marejeleo, marekebisho, na uhamishaji katika nafasi moja ya kazi laini na inayojibu.",
      stacksLayer: "Safu ya Uthibitisho ya Stacks",
      stacksLayerDesc: "Imeundwa kwa uthibitisho wa utafiti wa baadaye, motisha za sBTC, na ujumuishaji wa mkataba wa busara wa Clarity kwenye Stacks.",
      create: "Unda",
      dashboard: "Dashibodi",
      about: "Kuhusu",
      signIn: "Ingia",
      signOut: "Toka",
      newThesis: "Tasnifu Mpya",
      myLibrary: "Maktaba Yangu ya Utafiti",
      manageDrafts: "Dhibiti rasimu za tasnifu zilizohifadhiwa na kazi ya utafiti.",
      noSavedFound: "Hakuna Tasnifu Iliyohifadhiwa Iliyopatikana",
      startGenerating: "Anza kuunda tasnifu na uihifadhi ili kuiona hapa katika maktaba yako binafsi.",
      initiate: "Anzisha Uundaji",
      openDraft: "Fungua Rasimu",
      saveDraft: "Hifadhi Rasimu",
      exportPptx: "Hamisha PPTX",
      exportPdf: "Hamisha PDF",
      regenerate: "Unda Upya Sura",
      aboutTitle: "Kuhusu ThesisAI",
      aboutDesc: "ThesisAI ni nafasi ya kazi ya utafiti inayojitegemea inayolingana na Stacks ambayo inageuza vyanzo vilivyotolewa na mtumiaji kuwa rasimu za kitaaluma zilizopangwa, wakati ikitayarisha bidhaa kwa chanzo cha nyaraka kinachoweza kuthibitishwa kwenye miundombinu inayolindwa na Stacks.",
      disclaimerTitle: "Kanusho na Maadili",
      disclaimerDesc: "Chombo hiki ni msaidizi wa AI. AI inaweza kuona ndoto au kutoa taarifa zisizo sahihi. Daima thibitisha ukweli na manukuu. ThesisAI inakusudiwa kusaidia, si kubadilisha, fikra makini. Itumie kwa uwajibikaji na uzingatie miongozo ya uadilifu wa kitaaluma ya taasisi yako.",
      donationTitle: "Saidia Mradi Huu",
      donationDesc: "Mradi huu unaendelezwa kwa kujitegemea ili kusaidia wanafunzi duniani kote. Ikiwa unaupata kuwa wa manufaa, fikiria kusaidia matengenezo na maendeleo zaidi.",
      languageName: "Kiswahili",
      saveConfirmation: "Tasnifu imehifadhiwa kwa mafanikio!",
      loginRequirement: "Tafadhali ingia kwanza ili kuhifadhi maendeleo yako.",
      revertConfirmation: "Una uhakika unataka kurudi kwenye toleo hili? Mabadiliko yoyote ambayo hayajahifadhiwa katika mwonekano wa sasa yatapotea.",
      step1Title: "Msingi wa Maarifa",
      step1Desc: "Pakia PDF, bandika URL, au weka maandishi ghafi ili kuongoza utafiti wa AI.",
      addUrl: "Ongeza URL",
      pasteText: "Bandika Maandishi",
      configureTitle: "Boresha Matokeo",
      major: "Taaluma ya Kitaaluma",
      thesisLevel: "Kiwango cha Tasnifu",
      writingStyle: "Mtindo wa Uandishi",
      citationStyle: "Mtindo wa Manukuu",
      generateFull: "Unda Tasnifu Kamili",
      processing: "Inachakata...",
      thesisTitle: "Kichwa cha Tasnifu (Hiari)",
      titlePlaceholder: "Acha AI iamue au andika chako mwenyewe...",
      generateTitles: "Unda Chaguo za Kichwa kutoka vyanzo",
      antiPlagiarismDesc: "Inaeleza upya kwa kawaida ili kupunguza alama za mfanano.",
      language: "Lugha Lengwa",
      contentLength: "Urefu wa Maudhui",
      fontProfile: "Wasifu wa Fonti",
      antiPlagiarism: "Kupinga Wizi wa Kazi",
      ctaBadge: "Tayari kwa Tasnifu",
      ctaTitle: "Matokeo ya kiwango cha kitaaluma, chanzo cha utafiti kwenye mnyororo kinakuja.",
      ctaDesc: "Ramani ya Stacks: thibitisha hashi za nyaraka za mwisho kwa Clarity, toa beji za wakaguzi, na ongeza motisha zinazolingana na sBTC kwa wachangiaji huku chanzo cha utafiti kinavyobadilika.",
      ctaButton: "Anza Kuandika Sasa",
      walletGuideTitle: "Jinsi ya Kuunganisha Pochi Yako",
      walletGuideDesc: "Unganisha pochi yako ya Stacks ili kuangalia salio lako la $THESIS na kutoa Cheti chako cha Tasnifu kwenye mnyororo.",
      walletGuideStep1: "Sakinisha kiendelezi cha pochi cha Leather au Xverse kwenye kivinjari chako",
      walletGuideStep2: "Bofya kitufe cha \"Connect Stacks\" kwenye urambazaji wa juu",
      walletGuideStep3: "Kubali ombi la muunganisho kwenye dirisha ibukizi la pochi yako",
      walletGuideStep4: "Salio lako la $THESIS litaonekana kiotomatiki",
      walletGuideMobile: "Kwenye simu, fungua tovuti hii ndani ya kivinjari cha ndani cha Leather au Xverse kwa ufikiaji wa pochi.",
      walletGuideLeather: "Pata Pochi ya Leather",
      walletGuideXverse: "Pata Pochi ya Xverse",
      walletGuideLoginTitle: "Ingia ili Kufikia Dashibodi Yako",
      walletGuideLoginDesc: "Ingia kwa Google ili kuhifadhi rasimu za tasnifu yako, kuona historia ya uundaji, na kudhibiti maktaba yako ya utafiti kwenye vifaa vyote.",
      walletGuideLoginBtn: "Ingia kwa Google",
      walletGuideOrHold: "Au shika tokeni 1,000 za $THESIS",
      stakeTitle: "Fungua Ufikiaji Kamili",
      stakeDesc: "Fungua vipengele vyote vya ThesisAI kwa kushika tokeni 1,000 za $THESIS kwenye pochi yako iliyounganishwa.",
      stakeOption1: "Shika $THESIS 1,000",
      stakeOption1Desc: "Shika angalau tokeni 1,000 za $THESIS kwenye pochi yako ya Stacks iliyounganishwa ili kufungua vipengele vyote kwa kudumu.",
      stakeCheckBalance: "Angalia Salio Langu la $THESIS",

      saveUnlimitedDrafts: "Hifadhi rasimu za tasnifu zisizo na kikomo kwenye maktaba yako",
      accessGenHistory: "Fikia historia ya uundaji na masahihisho",
      syncDevices: "Sawazisha kiotomatiki kwenye vifaa vyote",
      viewCertificates: "Tazama na dhibiti vyeti vilivyotolewa",
      signedInAsPrefix: "Umeingia kama",
      accessGate: "Lango la Ufikiaji",
      activeNow: "Inafanya Kazi Sasa",
      connectWalletBtn: "Unganisha Pochi",
      communityTraction: "Ushiriki wa Jamii",
      researchersGenerating: "Watafiti tayari wanaunda.",
      thesesGenerated: "Tasnifu Zilizoundwa",
      latestBarLive: "upau wa hivi karibuni ni data ya moja kwa moja kwenye mnyororo",
      monthsActive: "Miezi Inayofanya Kazi",
      exportFormatsLabel: "Miundo ya Kuhamisha",
      revisionsLabel: "Masahihisho",
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
  const LANGUAGE_OPTIONS: { code: AppLanguage; nativeLabel: string; aiTargetName: string }[] = [
    { code: 'en', nativeLabel: 'English', aiTargetName: 'English' },
    { code: 'id', nativeLabel: 'Bahasa Indonesia', aiTargetName: 'Indonesian' },
    { code: 'ms', nativeLabel: 'Bahasa Melayu', aiTargetName: 'Malay' },
    { code: 'ar', nativeLabel: 'العربية', aiTargetName: 'Arabic' },
    { code: 'es', nativeLabel: 'Español (Latin)', aiTargetName: 'Spanish' },
    { code: 'pt', nativeLabel: 'Português (Latin)', aiTargetName: 'Portuguese' },
    { code: 'ru', nativeLabel: 'Русский', aiTargetName: 'Russian' },
    { code: 'fr', nativeLabel: 'Français', aiTargetName: 'French' },
    { code: 'vi', nativeLabel: 'Tiếng Việt', aiTargetName: 'Vietnamese' },
    { code: 'th', nativeLabel: 'ภาษาไทย', aiTargetName: 'Thai' },
    { code: 'hi', nativeLabel: 'हिन्दी', aiTargetName: 'Hindi' },
    { code: 'fa', nativeLabel: 'فارسی', aiTargetName: 'Persian' },
    { code: 'ja', nativeLabel: '日本語', aiTargetName: 'Japanese' },
    { code: 'ko', nativeLabel: '한국어', aiTargetName: 'Korean' },
    { code: 'ha', nativeLabel: 'Hausa', aiTargetName: 'Hausa' },
    { code: 'sw', nativeLabel: 'Kiswahili', aiTargetName: 'Swahili' },
  ];

  const setAppLanguage = (code: AppLanguage) => {
    setLang(code);
    const option = LANGUAGE_OPTIONS.find((o) => o.code === code);
    setConfig(prev => ({
      ...prev,
      targetLanguage: option?.aiTargetName || 'English',
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
      // Uses the base64 JSON endpoint (not blob) because many in-app wallet
      // browsers (Xverse, Leather) run a webview that can't resolve blob:
      // URLs created by URL.createObjectURL - clicking the download link
      // there silently does nothing. A data: URI built from base64 and
      // navigated to directly works in both normal browsers and webviews.
      const response = await axios.post('/api/export-docx-base64', { markdown: md, title: structure.title });
      const { base64, filename, mimeType } = response.data;
      const dataUri = `data:${mimeType};base64,${base64}`;
      const link = document.createElement('a');
      link.href = dataUri;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (e: any) {
      alert("Failed to export DOCX: " + (e?.response?.data?.error || e.message));
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

      // .save() internally uses URL.createObjectURL, which many in-app
      // wallet browsers (Xverse, Leather) run in a webview that can't
      // resolve - the download silently does nothing there. Generating a
      // base64 data URI instead and navigating an <a download> link to it
      // works in both normal browsers and those webviews.
      const pdfInstance = await html2pdf().from(container).set(opt).toPdf().get('pdf');
      const dataUri = pdfInstance.output('datauristring');
      const link = document.createElement('a');
      link.href = dataUri;
      link.setAttribute('download', `${titleSafe}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
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
    // Many in-app wallet browsers (Xverse, Leather) run a webview that does
    // not implement the Web Share API at all, so navigator.share can be
    // undefined there. Fall back to copying the link instead of doing
    // nothing silently.
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user cancelled the native share sheet
        // Any other failure (including "not supported" on some webviews
        // that define navigator.share but throw when called) falls through
        // to the clipboard fallback below.
      }
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      alert('Link copied to clipboard (sharing isn\'t supported in this browser).');
    } catch {
      alert(`Copy this link to share: ${shareData.url}`);
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
    <div dir={lang === 'ar' || lang === 'fa' ? 'rtl' : 'ltr'} className="min-h-screen bg-[#0c0d10] font-sans text-[#f0f1f3] pb-20">
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
            <LanguageSwitcher current={lang} options={LANGUAGE_OPTIONS} onSelect={(code) => setAppLanguage(code as AppLanguage)} variant="compact" />
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
          <div className="flex sm:hidden items-center gap-1.5">
            {stacksWallet.isConnected && stacksWallet.address ? (
              <>
                <button
                  onClick={() => setShowMobileDisconnect((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-green-500/30 bg-green-500/10 text-[10px] font-black uppercase tracking-wider text-green-400"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>{stacksWallet.address.slice(0, 4)}..{stacksWallet.address.slice(-4)}</span>
                </button>
                <AnimatePresence>
                  {showMobileDisconnect && (
                    <motion.button
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      onClick={() => {
                        stacksWallet.disconnectWallet().catch(() => undefined);
                        setShowMobileDisconnect(false);
                      }}
                      className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-[9px] font-black uppercase tracking-wider text-red-400 whitespace-nowrap overflow-hidden"
                    >
                      <LogOut className="w-3 h-3 shrink-0" />
                      Disconnect
                    </motion.button>
                  )}
                </AnimatePresence>
              </>
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
                <LanguageSwitcher current={lang} options={LANGUAGE_OPTIONS} onSelect={(code) => setAppLanguage(code as AppLanguage)} variant="full" />
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
                          t('saveUnlimitedDrafts'),
                          t('accessGenHistory'),
                          t('syncDevices'),
                          t('viewCertificates'),
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
                          {t('signedInAsPrefix')} {user.displayName || user.email}
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
                      {t('accessGate')}
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
                        badge: t('activeNow'),
                        action: () => stacksWallet.isConnected ? null : stacksWallet.connectWallet().catch(() => undefined),
                        actionLabel: stacksWallet.isConnected
                          ? `${stacksWallet.thesisBalance.toLocaleString()} $THESIS`
                          : t('connectWalletBtn'),
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
                      {t('communityTraction')}
                    </div>
                    <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
                      {t('researchersGenerating')}
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
                            {t('thesesGenerated')}
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
                      2025 – Jun 2026 · {t('latestBarLive')}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { val: anchoredThesesCount !== null ? anchoredThesesCount.toLocaleString() : '—', label: t('thesesGenerated'), icon: GraduationCap },
                      { val: '7', label: t('monthsActive'), icon: Clock },
                      { val: '4', label: t('exportFormatsLabel'), icon: Download },
                      { val: '∞', label: t('revisionsLabel'), icon: RotateCcw },
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
                          {LANGUAGE_OPTIONS.map((opt) => (
                            <option key={opt.code} value={opt.aiTargetName}>{opt.aiTargetName} ({opt.nativeLabel})</option>
                          ))}
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

      {/* Footer — includes Suggest Feature */}
      <footer className="w-full border-t border-[#1f2128] bg-[#0c0d10] mt-8">
        {/* Footer bottom bar */}
        <div className="border-t border-[#1a1c22] py-5 px-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <div className="text-[10px] text-[#4a4b4e] font-sans tracking-widest uppercase">Built on the Stacks Layer for verifiable research provenance</div>
              <div className="text-[10px] text-[#3a3d45] mt-0.5 font-mono">ThesisAI Research Agent • © 2026</div>
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
