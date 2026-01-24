"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase";
import { 
  format, startOfYear, eachMonthOfInterval, isSameMonth, 
  isWithinInterval, startOfMonth, endOfMonth, parseISO, addMonths, 
  setDate, isAfter, subMonths 
} from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// --- 🔒 TYPES & INTERFACES ---
interface Member {
  id: string;
  member_name: string;
  carry_forward: number;
  joined_at: string;
}

interface Loan {
  id: string;
  member_id: string;
  amount: number;
  principal: number;
  interest_accrued: number;
  status: 'Active' | 'Paid' | 'Defaulted';
  due_date: string;
  last_repayment_date?: string;
  created_at: string;
  members?: Member;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

interface Settings {
  id?: string;
  monthly_contribution: number;
  loan_interest_rate: number;
  late_fee_amount: number;
}

type UserRole = 'GUEST' | 'MEMBER' | 'TREASURER' | 'CHIEF';

// --- 🎨 ICONS ---
const MenuIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 18 12"/></svg>;
const SearchIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
const Spinner = () => <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;

// --- 🔔 TOAST COMPONENT ---
const ToastContainer = ({ toasts }: { toasts: { id: number, msg: string, type: 'success' | 'error' }[] }) => (
  <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
    {toasts.map(t => (
      <div key={t.id} className={`animate-in slide-in-from-right fade-in duration-300 px-6 py-4 rounded-xl shadow-2xl border flex items-center gap-3 ${t.type === 'success' ? 'bg-green-950/90 border-green-800 text-green-200' : 'bg-red-950/90 border-red-800 text-red-200'}`}>
        <div className={`w-2 h-2 rounded-full ${t.type === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-xs font-black uppercase tracking-wide">{t.msg}</span>
      </div>
    ))}
  </div>
);

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("Dashboard");
  
  // --- 🔐 AUTH STATES ---
  const [authStep, setAuthStep] = useState<0 | 1 | 2>(0); // 0=PIN, 1=ROLE, 2=LOGGED_IN
  const [pin, setPin] = useState("");
  const [roleSelection, setRoleSelection] = useState<UserRole | null>(null);
  const [authInput, setAuthInput] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>('GUEST');
  const [loggedInName, setLoggedInName] = useState("Guest");
  const [imgError, setImgError] = useState(false);

  // --- UI STATES ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDisbursing, setIsDisbursing] = useState(false); 
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  
  // --- NOTIFICATIONS ---
  const [toasts, setToasts] = useState<{ id: number, msg: string, type: 'success' | 'error' }[]>([]);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // --- DATA STATE ---
  const [config, setConfig] = useState<Settings>({ monthly_contribution: 4000, loan_interest_rate: 10, late_fee_amount: 500 });
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM')); 

  // --- INPUTS ---
  const [regName, setRegName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [fineAmount, setFineAmount] = useState(""); 
  const [loanMemberId, setLoanMemberId] = useState("");
  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanDuration, setLoanDuration] = useState("1");
  const [tempConfig, setTempConfig] = useState({ contribution: "4000", interest: "10", lateFee: "500" });

  const PROFILE_URL = "/me.jpg";
  const today = new Date();
  const currentDay = today.getDate();
  const isSafeZone = currentDay >= 3 && currentDay <= 25;
  const startOfYearDate = startOfYear(today);
  const monthsList = eachMonthOfInterval({ start: startOfYearDate, end: today });

  // Permissions Helper
  const canEdit = currentUserRole === 'CHIEF' || currentUserRole === 'TREASURER';

  useEffect(() => { setMounted(true); }, []);

  // --- 🔄 SYNC DATA ---
  const syncAllData = useCallback(async () => {
    try {
      const [sRes, mRes, lRes, tRes] = await Promise.all([
          supabase.from('settings').select('*').single(),
          supabase.from('members').select('*').order('member_name', { ascending: true }),
          supabase.from('loans').select('*, members(member_name)').order('created_at', { ascending: false }),
          supabase.from('transactions').select('*').order('created_at', { ascending: false })
      ]);
      
      let currentConfig = config;
      if (sRes.data) {
          setConfig(sRes.data);
          currentConfig = sRes.data;
          setTempConfig({ 
              contribution: sRes.data.monthly_contribution.toString(), 
              interest: sRes.data.loan_interest_rate.toString(),
              lateFee: (sRes.data.late_fee_amount || 500).toString()
          });
      }
      if (mRes.data) setMembers(mRes.data);
      if (lRes.data) setLoans(lRes.data);
      if (tRes.data) setTransactions(tRes.data);

      if (mRes.data && tRes.data && currentConfig) {
           // Auto fine logic (kept from previous code)
           const processLateFines = async () => {
               if (!currentConfig.late_fee_amount) return;
               const pastMonths = eachMonthOfInterval({ start: startOfYearDate, end: subMonths(today, 1) });
               for (const member of mRes.data) {
                   for (const monthDate of pastMonths) {
                       const monthName = format(monthDate, 'MMMM');
                       const penaltyDate = setDate(addMonths(monthDate, 1), 2);
                       if (isAfter(today, penaltyDate)) {
                           const fineDesc = `Late Fine: ${monthName} - ${member.member_name}`;
                           if (!tRes.data.some(t => t.description === fineDesc)) {
                               const obligation = (monthsList.findIndex(m => isSameMonth(m, monthDate)) + 1) * currentConfig.monthly_contribution;
                               if (member.carry_forward < obligation) {
                                   const fine = currentConfig.late_fee_amount;
                                   await supabase.from('members').update({ carry_forward: member.carry_forward - fine }).eq('id', member.id);
                                   await supabase.from('transactions').insert([{ amount: -fine, type: 'Late Penalty', description: fineDesc }]);
                               }
                           }
                       }
                   }
               }
           };
           processLateFines();
      }

    } catch (e) {
      showToast("Connection Error", "error");
    }
  }, []); 

  useEffect(() => {
    if (mounted && authStep >= 1) syncAllData(); // Fetch data early to validate member names
  }, [mounted, authStep, syncAllData]);

  // --- 🔐 AUTH HANDLER ---
  const handlePinUnlock = () => {
      if (pin === "7777") {
          setAuthStep(1); // Move to Role Selection
          syncAllData(); // Pre-fetch members for validation
      } else {
          showToast("INVALID PIN", "error");
      }
  };

  const handleRoleLogin = () => {
      if (!roleSelection) return;

      if (roleSelection === 'CHIEF') {
          if (authInput === "Sultan01") {
              setCurrentUserRole('CHIEF');
              setLoggedInName("CHIEF");
              setAuthStep(2);
          } else showToast("Access Denied: Wrong Password", "error");
      } 
      else if (roleSelection === 'TREASURER') {
          if (authInput === "Coder01") {
              setCurrentUserRole('TREASURER');
              setLoggedInName("Belindah");
              setAuthStep(2);
          } else showToast("Access Denied: Wrong Password", "error");
      } 
      else if (roleSelection === 'MEMBER') {
          // Check if name exists in loaded members
          const foundMember = members.find(m => m.member_name.toLowerCase().trim() === authInput.toLowerCase().trim());
          if (foundMember) {
              setCurrentUserRole('MEMBER');
              setLoggedInName(foundMember.member_name);
              setAuthStep(2);
          } else {
              showToast("Member not found in registry", "error");
          }
      }
  };

  const handleLogout = () => {
      setAuthStep(0);
      setPin("");
      setRoleSelection(null);
      setAuthInput("");
      setCurrentUserRole('GUEST');
  };

  // --- 🧮 FINANCIAL LOGIC ---
  const getMemberFinancials = useCallback((member: Member) => {
    if (!member) return { netBalance: 0, totalPaid: 0, totalExpected: 0, breakdown: [] };
    const currentMonthIndex = today.getMonth();
    const monthsElapsed = currentMonthIndex + 1; 
    const totalExpectedToDate = monthsElapsed * config.monthly_contribution;
    const rawWallet = member.carry_forward || 0;
    const netBalance = rawWallet - totalExpectedToDate;

    let runningAllocation = rawWallet;
    const breakdown: any[] = [];
    monthsList.forEach((date) => {
        const expectedThisMonth = config.monthly_contribution;
        const isCurrentMonth = isSameMonth(date, today);
        let status = 'Pending';
        if (runningAllocation >= expectedThisMonth) {
            status = 'Clear'; runningAllocation -= expectedThisMonth;
        } else {
            status = isCurrentMonth ? 'Pending' : 'Arrears'; runningAllocation = 0;
        }
        breakdown.push({ month: format(date, 'MMMM'), expected: expectedThisMonth, status, isPast: !isCurrentMonth });
    });
    return { netBalance, totalPaid: rawWallet, totalExpected: totalExpectedToDate, breakdown };
  }, [config.monthly_contribution, monthsList]);

  // --- 🔍 FILTERED MEMBERS ---
  const filteredMembers = useMemo(() => {
    return members.filter(m => m.member_name.toLowerCase().includes(memberSearch.toLowerCase()));
  }, [members, memberSearch]);

  const ledger = useMemo(() => {
    const targetDate = parseISO(reportMonth + "-01");
    const start = startOfMonth(targetDate);
    const end = endOfMonth(targetDate);
    const monthTrans = transactions.filter(t => isWithinInterval(parseISO(t.created_at), { start, end }));
    const drTrans = monthTrans.filter(t => t.amount > 0); 
    const crTrans = monthTrans.filter(t => t.amount < 0); 
    const totalDr = drTrans.reduce((acc, t) => acc + t.amount, 0);
    const totalCr = crTrans.reduce((acc, t) => acc + Math.abs(t.amount), 0);
    return { drTrans, crTrans, totalDr, totalCr, balance: totalDr - totalCr, grandTotal: Math.max(totalDr, totalCr) };
  }, [transactions, reportMonth]);

  // --- ACTIONS ---
  const handlePayment = async () => {
    if(!canEdit) return showToast("Permission Denied: Read Only", "error");
    if (!paymentAmount || !selectedMember) return;
    setIsProcessing(true);
    const amount = Number(paymentAmount);
    const newBalance = (selectedMember.carry_forward || 0) + amount;
    const { error } = await supabase.from('members').update({ carry_forward: newBalance }).eq('id', selectedMember.id);
    if (!error) {
        await supabase.from('transactions').insert([{ amount, type: 'Deposit', description: `Payment: ${selectedMember.member_name} (by ${loggedInName})` }]);
        setPaymentAmount(""); await syncAllData(); showToast("Payment Processed");
    }
    setIsProcessing(false);
  };

  const handleApplyFine = async (monthName: string) => {
    if(!canEdit) return showToast("Permission Denied: Read Only", "error");
    if (!fineAmount) return showToast("Enter fine amount", "error");
    if(!confirm(`Apply fine?`)) return;
    setIsProcessing(true);
    const fine = Number(fineAmount);
    const newBalance = (selectedMember!.carry_forward || 0) - fine; 
    const { error } = await supabase.from('members').update({ carry_forward: newBalance }).eq('id', selectedMember!.id);
    if (!error) {
        await supabase.from('transactions').insert([{ amount: -fine, type: 'Fine', description: `Fine: ${monthName} - ${selectedMember!.member_name}` }]);
        setFineAmount(""); await syncAllData(); showToast("Fine Applied");
    }
    setIsProcessing(false);
  };

  const initiateLoan = async () => {
    // SECURITY GATE
    if(!canEdit) return showToast("ACCESS DENIED: Read Only Mode", "error");

    if (!loanMemberId || !loanPrincipal) return showToast("Missing Fields", "error");
    
    // FIX: We convert both IDs to strings to ensure they match perfectly
    const borrower = members.find(m => String(m.id) === String(loanMemberId)); 
    
    // SAFETY CHECK: If we can't find the name, stop immediately.
    if (!borrower) return showToast("Error: Could not identify member name", "error");

    setIsDisbursing(true);
    const principal = Number(loanPrincipal);
    const interest = principal * (config.loan_interest_rate / 100);
    const totalDue = principal + interest;
    
    const dueDate = addMonths(new Date(), Number(loanDuration));
    
    const { error } = await supabase.from('loans').insert([{
      member_id: loanMemberId, 
      amount: totalDue, 
      principal: principal, 
      interest_accrued: interest,
      status: 'Active', 
      due_date: dueDate.toISOString().split('T')[0], 
      created_at: new Date().toISOString()
    }]);
    
    if (!error) {
      // NOW SECURE: We use the 'borrower' variable we found above
      await supabase.from('transactions').insert([{ 
          amount: -principal, 
          type: 'Loan Issuance', 
          description: `Disbursed to ${borrower.member_name}` 
      }]);
      setLoanPrincipal(""); 
      await syncAllData(); 
      showToast(`Loan Disbursed to ${borrower.member_name}`);
    } else {
        showToast("Database Error during Loan", "error");
    }
    setIsDisbursing(false);
  };

  const handleLoanRepayment = async (loanId: string, currentBalance: number, memberName: string) => {
    if(!canEdit) return showToast("Permission Denied: Read Only", "error");
    const amountStr = prompt(`Repayment for ${memberName} (Current Debt: ${currentBalance}):`);
    if (!amountStr) return;
    const repayment = Number(amountStr);
    const newBalance = currentBalance - repayment;
    const newStatus = newBalance <= 0 ? 'Paid' : 'Active';
    const { error } = await supabase.from('loans').update({ amount: newBalance, status: newStatus, last_repayment_date: new Date().toISOString().split('T')[0] }).eq('id', loanId);
    if (!error) {
      await supabase.from('transactions').insert([{ amount: repayment, type: 'Loan Repayment', description: `Loan Repayment: ${memberName}` }]);
      await syncAllData(); showToast(`Repayment recorded`);
    }
  };

  const handleSaveSettings = async () => {
      if(!canEdit) return showToast("Permission Denied", "error");
      setIsSavingSettings(true);
      const payload = { monthly_contribution: Number(tempConfig.contribution), loan_interest_rate: Number(tempConfig.interest), late_fee_amount: Number(tempConfig.lateFee) };
      const { data: existing } = await supabase.from('settings').select('id').single();
      if (existing) await supabase.from('settings').update(payload).eq('id', existing.id);
      else await supabase.from('settings').insert([payload]);
      showToast("Settings Updated"); await syncAllData(); setIsSavingSettings(false);
  };

  // --- 📄 PDF DOWNLOADERS (Available to everyone) ---
  const handleDownloadMemberHistory = (member: Member) => {
     const memLoans = loans.filter(l => l.member_id === member.id).map(l => ({ date: l.created_at.split('T')[0], type: 'LOAN TAKEN', amount: l.principal, details: `Status: ${l.status}` }));
     const memTrans = transactions.filter(t => t.description.includes(member.member_name)).map(t => ({ date: t.created_at.split('T')[0], type: t.type.toUpperCase(), amount: t.amount, details: t.description }));
     const combined = [...memLoans, ...memTrans].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
     const doc = new jsPDF();
     doc.text(`Financial History: ${member.member_name}`, 14, 20);
     autoTable(doc, { startY: 30, head: [['Date', 'Type', 'Amount', 'Details']], body: combined.map(r => [r.date, r.type, r.amount, r.details]) });
     doc.save(`${member.member_name}_History.pdf`);
  };

  const handleDownloadMonthReport = () => {
    const doc = new jsPDF();
    doc.text(`Ledger Report: ${reportMonth}`, 14, 20);
    const rows = transactions.filter(t => t.created_at.includes(reportMonth)).map(t => [t.created_at.split('T')[0], t.description, t.amount > 0 ? t.amount : '-', t.amount < 0 ? Math.abs(t.amount) : '-']);
    autoTable(doc, { startY: 30, head: [['Date', 'Description', 'Dr', 'Cr']], body: rows });
    doc.save(`Ledger_${reportMonth}.pdf`);
  };

  // --- RENDER ---
  if (!mounted) return null;

  // 1. PIN SCREEN
  if (authStep === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-900/40 via-black to-black animate-pulse-slow"></div>
        <div className="w-full max-w-sm bg-slate-900/80 backdrop-blur-xl p-10 rounded-[2rem] shadow-2xl border border-slate-800 text-center flex flex-col justify-between min-h-[600px] relative z-10">
          <div className="flex-1 flex flex-col justify-center">
             <div className="mb-10">
                <div className="h-28 w-28 bg-black rounded-2xl border border-slate-700 mx-auto flex items-center justify-center mb-8 overflow-hidden p-1 shadow-2xl shadow-green-900/20">
                    <img src={imgError ? "https://ui-avatars.com/api/?name=Admin&background=006a33&color=fff" : PROFILE_URL} onError={() => setImgError(true)} alt="Admin" className="h-full w-full object-cover rounded-xl" />
                </div>
                <h1 className="text-white text-3xl font-black italic tracking-tighter mb-2">MONEY<span className="text-[#006a33]">VAULT</span></h1>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.4em]">System Locked</p>
             </div>
             <div className="space-y-6">
                <div className="bg-black/50 rounded-xl border border-slate-800 p-2 focus-within:border-green-600 transition-colors">
                    <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
                        className="w-full bg-transparent border-none p-4 text-center text-4xl text-white tracking-[0.5em] outline-none font-mono placeholder-slate-700"
                        placeholder="••••" maxLength={4} />
                </div>
                <button onClick={handlePinUnlock} 
                    className="w-full bg-[#006a33] hover:bg-[#005228] py-5 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transition-all active:scale-95">
                    Unlock Terminal
                </button>
             </div>
          </div>
        </div>
        <ToastContainer toasts={toasts} />
      </main>
    );
  }

  // 2. ROLE SELECTION SCREEN
  if (authStep === 1) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-black p-6 font-sans relative overflow-hidden">
             <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 via-black to-black"></div>
             
             {!roleSelection ? (
                 // STEP 2a: SELECT ROLE
                 <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10 animate-in zoom-in-95 duration-300">
                     <button onClick={() => setRoleSelection('CHIEF')} className="group bg-slate-900/80 p-8 rounded-[2rem] border border-slate-800 hover:border-[#006a33] hover:bg-slate-800 transition-all text-center h-80 flex flex-col items-center justify-center gap-6">
                         <div className="w-20 h-20 rounded-full bg-black border border-slate-700 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">👑</div>
                         <div>
                             <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Chief</h2>
                             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">System Admin</p>
                         </div>
                     </button>
                     <button onClick={() => setRoleSelection('TREASURER')} className="group bg-slate-900/80 p-8 rounded-[2rem] border border-slate-800 hover:border-blue-600 hover:bg-slate-800 transition-all text-center h-80 flex flex-col items-center justify-center gap-6">
                         <div className="w-20 h-20 rounded-full bg-black border border-slate-700 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">💎</div>
                         <div>
                             <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Belindah</h2>
                             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">Treasurer</p>
                         </div>
                     </button>
                     <button onClick={() => setRoleSelection('MEMBER')} className="group bg-slate-900/80 p-8 rounded-[2rem] border border-slate-800 hover:border-slate-500 hover:bg-slate-800 transition-all text-center h-80 flex flex-col items-center justify-center gap-6">
                         <div className="w-20 h-20 rounded-full bg-black border border-slate-700 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">👤</div>
                         <div>
                             <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Member</h2>
                             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">View Only</p>
                         </div>
                     </button>
                 </div>
             ) : (
                 // STEP 2b: AUTHENTICATE ROLE
                 <div className="w-full max-w-sm bg-slate-900/80 backdrop-blur-xl p-10 rounded-[2rem] shadow-2xl border border-slate-800 text-center relative z-10 animate-in fade-in slide-in-from-bottom-8">
                     <button onClick={() => { setRoleSelection(null); setAuthInput(""); }} className="absolute top-6 left-6 text-slate-500 hover:text-white text-xs font-black uppercase">← Back</button>
                     <h2 className="text-white text-2xl font-black uppercase italic mb-8 mt-6">
                         {roleSelection === 'MEMBER' ? 'Identify Yourself' : 'Verify Credentials'}
                     </h2>
                     
                     <div className="space-y-4">
                         <input 
                            type={roleSelection === 'MEMBER' ? "text" : "password"} 
                            value={authInput} 
                            onChange={(e) => setAuthInput(e.target.value)}
                            className="w-full bg-black border border-slate-700 text-white p-4 rounded-xl font-bold text-center outline-none focus:border-[#006a33] transition-colors placeholder-slate-700"
                            placeholder={roleSelection === 'MEMBER' ? "Enter Full Name" : "Enter Password"} 
                         />
                         
                         <button onClick={handleRoleLogin} className="w-full bg-white text-black py-4 rounded-xl font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">
                             Access System
                         </button>
                     </div>
                 </div>
             )}
             <ToastContainer toasts={toasts} />
        </main>
      );
  }

  // 3. MAIN DASHBOARD (LOGGED IN)
  if (selectedMember && activeTab === "Members") {
    const fin = getMemberFinancials(selectedMember);
    return (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center backdrop-blur-md p-4 md:p-6 animate-in fade-in duration-200">
            <div className="bg-slate-900 w-full max-w-5xl h-[90vh] rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl border border-slate-800 animate-in zoom-in-95 duration-200 relative">
                
                <button onClick={(e) => { e.stopPropagation(); setSelectedMember(null); }} 
                    className="absolute top-6 right-6 z-20 h-10 w-10 bg-slate-800 hover:bg-red-900 text-white rounded-full flex items-center justify-center transition-all border border-slate-700 hover:border-red-700">✕</button>

                <div className="bg-slate-950 p-8 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center shrink-0 gap-4">
                    <div>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedMember(null); }} className="text-[10px] text-slate-400 font-black uppercase tracking-widest hover:text-white mb-2 flex items-center gap-1">← Back to List</button>
                        <h2 className="text-3xl font-black uppercase italic text-white tracking-tight">{selectedMember.member_name}</h2>
                        <div className="flex flex-wrap gap-4 mt-3">
                             <div className="px-4 py-2 bg-slate-800 rounded-xl border border-slate-700">
                                 <span className="text-[9px] uppercase text-slate-400 block tracking-wider">Net Balance</span>
                                 <span className={`text-xl font-black ${fin.netBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                     {fin.netBalance > 0 ? '(+) ' : ''}{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(fin.netBalance)}
                                 </span>
                             </div>
                             <div className="px-4 py-2 bg-slate-800 rounded-xl border border-slate-700">
                                 <span className="text-[9px] uppercase text-slate-400 block tracking-wider">Gross Paid</span>
                                 <span className="text-xl font-black text-white">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(fin.totalPaid)}</span>
                             </div>
                             <button onClick={() => handleDownloadMemberHistory(selectedMember)} className="px-4 py-2 bg-[#006a33] text-white rounded-xl text-[10px] font-black uppercase hover:bg-green-600 transition-colors border border-green-800 shadow-lg shadow-green-900/20">
                                 Download PDF ⬇
                             </button>
                        </div>
                    </div>
                    
                    {/* HIDE PAYMENT BOX IF READ ONLY */}
                    {canEdit && (
                    <div className="bg-slate-800 p-4 rounded-2xl w-full md:w-80 border border-slate-700 shadow-inner">
                        <p className="text-slate-400 text-[10px] font-black uppercase mb-2">Process Payment</p>
                        <div className="flex gap-2">
                            <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} 
                                className="w-full bg-slate-900 border border-slate-700 text-white p-3 rounded-xl font-bold text-sm outline-none placeholder-slate-600 focus:border-green-600 transition-colors" placeholder="Amount (KES)" />
                            <button onClick={handlePayment} disabled={isProcessing} className="bg-white text-black px-6 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200 transition-colors min-w-[80px] flex items-center justify-center">
                                {isProcessing ? <Spinner /> : "PAY"}
                            </button>
                        </div>
                    </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-8 bg-slate-900 scrollbar-thin scrollbar-thumb-slate-700">
                    <h3 className="text-slate-500 font-black text-xs uppercase tracking-widest mb-4">Financial Ledger ({today.getFullYear()})</h3>
                    <div className="grid grid-cols-1 gap-3 mb-8">
                        {fin.breakdown.map((record: any, idx: number) => (
                            <div key={idx} className={`p-4 rounded-2xl border flex items-center justify-between transition-all hover:scale-[1.01] ${record.status !== 'Clear' ? 'bg-red-950/10 border-red-900/30' : 'bg-slate-800/40 border-slate-800'}`}>
                                <div className="flex items-center gap-4">
                                    <div className="w-24">
                                        <h4 className="font-bold text-slate-200 uppercase text-xs">{record.month}</h4>
                                        <p className="text-[9px] text-slate-500 font-mono">Target: {record.expected}</p>
                                    </div>
                                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide ${record.status !== 'Clear' ? 'bg-red-900/20 text-red-400 border border-red-900/50' : 'bg-green-900/20 text-green-400 border border-green-900/50'}`}>
                                          {record.status}
                                    </div>
                                </div>
                                {/* HIDE FINE BUTTON IF READ ONLY */}
                                {canEdit && record.status !== 'Clear' && record.isPast && (
                                    <div className="flex gap-2">
                                        <input type="number" placeholder="Fine Amt" onChange={(e) => setFineAmount(e.target.value)} 
                                            className="w-24 bg-slate-950 border border-slate-700 p-2 rounded-lg text-[10px] text-white font-bold outline-none focus:border-red-500" />
                                        <button onClick={() => handleApplyFine(record.month)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-red-500 transition-colors flex items-center gap-2">
                                            {isProcessing ? <Spinner /> : "Fine"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <ToastContainer toasts={toasts} />
        </div>
    );
  }

  // MAIN LAYOUT
  return (
    <main className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
      <ToastContainer toasts={toasts} />
      
      {isSidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity" onClick={() => setIsSidebarOpen(false)}/>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#051b11] flex flex-col border-r border-slate-800 transform transition-transform duration-300 ease-out shadow-2xl lg:translate-x-0 lg:static ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-8 flex justify-between items-center">
          <h1 className="text-white text-2xl font-black italic tracking-tighter uppercase cursor-default">Chama<span className="text-[#006a33]">Pro</span></h1>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white p-2"><CloseIcon /></button>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          {["Dashboard", "Members", "Monthly Log", "Loan Manager", "Presentation", "Settings"].map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-6 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 ${
                activeTab === tab ? 'bg-[#006a33] text-white shadow-lg shadow-green-900/20 translate-x-2' : 'text-slate-500 hover:text-white hover:bg-white/5'
              }`}>
              {tab}
            </button>
          ))}
        </nav>
        <div className="p-4">
             <button onClick={handleLogout} className="w-full bg-red-950 text-red-400 py-3 rounded-xl font-black uppercase text-[10px] border border-red-900/50 hover:bg-red-900 hover:text-white transition-colors">Lock System 🔒</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative z-0">
        <header className="h-20 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 lg:px-8 flex justify-between items-center shrink-0 z-30 sticky top-0">
           <div className="flex items-center gap-4">
               <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-white bg-slate-800 p-2 rounded-lg hover:bg-slate-700 transition-colors"><MenuIcon /></button>
               <h2 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.5em] hidden sm:block">{activeTab} Terminal</h2>
           </div>
           
           <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                     <p className="text-white text-xs font-black uppercase">{loggedInName}</p>
                     <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">{currentUserRole}</p>
                </div>
                <div className="h-9 w-9 rounded-full bg-slate-800 overflow-hidden border border-slate-700 ring-2 ring-transparent hover:ring-[#006a33] transition-all">
                        <img src={PROFILE_URL} alt="User" className="h-full w-full object-cover" onError={(e:any) => e.target.style.display='none'}/>
                </div>
           </div>
        </header>

        <div className="flex-1 p-4 lg:p-8 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
          
          {/* DASHBOARD VIEW */}
          {activeTab === "Dashboard" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-slate-900 p-8 rounded-[2rem] shadow-lg border border-slate-800">
                    <p className="text-slate-500 text-[9px] font-black uppercase mb-2 tracking-widest">Total Liquidity</p>
                    <h3 className="text-3xl font-black text-white">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(transactions.reduce((acc,t)=>acc+t.amount,0))}</h3>
                </div>
                <div className="bg-slate-900 p-8 rounded-[2rem] shadow-lg border border-slate-800">
                    <p className="text-slate-500 text-[9px] font-black uppercase mb-2 tracking-widest">Active Loans Value</p>
                    <h3 className="text-3xl font-black text-blue-400">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(loans.filter(l=>l.status!=='Paid').reduce((acc,l)=>acc+l.amount,0))}</h3>
                </div>
                <div className="bg-slate-900 p-8 rounded-[2rem] shadow-lg border border-slate-800">
                    <p className="text-slate-500 text-[9px] font-black uppercase mb-2 tracking-widest">Members Count</p>
                    <h3 className="text-3xl font-black text-green-400">{members.length.toString().padStart(2, '0')}</h3>
                </div>
            </div>
          )}

          {/* MONTHLY LOG VIEW */}
          {activeTab === "Monthly Log" && (
            <div className="animate-in fade-in space-y-6">
                <div className="relative bg-gradient-to-br from-slate-900 to-black rounded-[2.5rem] p-10 overflow-hidden shadow-2xl flex items-center justify-between text-white border border-slate-800">
                    <div className={`absolute -right-20 -top-20 w-96 h-96 rounded-full blur-[100px] animate-pulse duration-[3000ms] opacity-20 ${isSafeZone ? 'bg-green-600' : 'bg-red-600'}`}></div>
                    <div className="relative z-10">
                        <p className="text-sm font-bold uppercase opacity-60 tracking-widest mb-2">Current Fiscal Period</p>
                        <h1 className="text-5xl font-black italic tracking-tighter mb-2">{format(today, 'MMMM yyyy')}</h1>
                        <p className="text-2xl font-mono text-slate-400">{format(today, 'eeee, do')}</p>
                    </div>
                </div>
                <div className="bg-slate-900 rounded-[2.5rem] p-8 shadow-sm border border-slate-800">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {members.map(m => {
                            const fin = getMemberFinancials(m);
                            const currentStatus = fin.breakdown.find((b: any) => b.month === format(today, 'MMMM'))?.status || 'Pending';
                            const isCleared = currentStatus === 'Clear';
                            return (
                                <div key={m.id} className={`p-5 rounded-2xl border-l-4 shadow-sm flex flex-col justify-between h-32 transition-transform hover:scale-105 ${!isCleared ? 'bg-red-950/20 border-red-600' : 'bg-green-950/20 border-green-600'}`}>
                                    <div>
                                        <p className="text-xs font-black uppercase truncate text-white">{m.member_name}</p>
                                        <p className="text-[10px] font-bold text-slate-500 mt-1">Status: <span className={isCleared ? "text-green-400" : "text-red-400"}>{currentStatus.toUpperCase()}</span></p>
                                    </div>
                                    <div className="bg-slate-950/50 p-1.5 rounded">
                                         <p className={`text-[10px] font-bold ${fin.netBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                              Net: {fin.netBalance > 0 ? '(+) ' : ''}{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(fin.netBalance)}
                                         </p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
          )}

          {/* Members VIEW */}
          {activeTab === "Members" && (
             <div className="space-y-6 animate-in slide-in-from-bottom-4">
                <div className="flex flex-col md:flex-row gap-4">
                    {/* ADD MEMBER - ONLY IF EDITABLE */}
                    {canEdit && (
                    <div className="bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-800 flex gap-4 flex-1">
                        <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} 
                            className="flex-1 bg-slate-950 border border-slate-800 text-white p-4 rounded-xl font-black uppercase text-xs outline-none focus:border-[#006a33] placeholder-slate-600 transition-colors" placeholder="New Member Full Name" />
                        <button onClick={async () => {
                            if(!regName) return;
                            setIsRegistering(true);
                            await supabase.from('members').insert([{ member_name: regName.toUpperCase(), carry_forward: 0, joined_at: new Date().toISOString() }]);
                            setRegName(""); await syncAllData(); setIsRegistering(false); showToast("Member Added Successfully");
                        }} disabled={isRegistering} className="bg-[#006a33] text-white px-8 rounded-xl font-black uppercase text-[10px] hover:bg-white hover:text-black transition-all flex items-center gap-2">
                            {isRegistering ? <Spinner /> : "Add"}
                        </button>
                    </div>
                    )}
                    
                    <div className={`bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-800 flex items-center gap-4 ${canEdit ? 'w-full md:w-1/3' : 'w-full'}`}>
                        <span className="text-slate-500"><SearchIcon /></span>
                        <input type="text" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} 
                            className="flex-1 bg-transparent border-none text-white text-xs font-bold uppercase outline-none placeholder-slate-600" placeholder="Search Member..." />
                    </div>
                </div>

                <div className="bg-slate-900 rounded-[2.5rem] shadow-lg overflow-hidden border border-slate-800 min-h-[400px]">
                   <table className="w-full text-left">
                      <thead className="bg-slate-950 text-[10px] font-black text-slate-500 uppercase">
                          <tr><th className="p-6 pl-8">Name</th><th className="p-6">Net Surplus</th><th className="p-6 text-right">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                         {filteredMembers.map(m => {
                            const fin = getMemberFinancials(m);
                            return (
                                <tr key={m.id} className="hover:bg-slate-800/50 cursor-pointer transition-colors group" onClick={() => setSelectedMember(m)}>
                                <td className="p-6 pl-8 font-black uppercase text-slate-200 group-hover:text-white transition-colors">{m.member_name}</td>
                                <td className="p-6">
                                    <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${fin.netBalance >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                                          {fin.netBalance > 0 ? '(+) ' : ''} {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(fin.netBalance)}
                                    </span>
                                </td>
                                <td className="p-6 text-right"><span className="text-[10px] font-bold text-slate-500 uppercase group-hover:text-[#006a33] transition-colors">View Profile →</span></td>
                                </tr>
                            );
                         })}
                      </tbody>
                   </table>
                </div>
             </div>
          )}

          {/* LOAN MANAGER */}
          {activeTab === "Loan Manager" && (
             <div className="space-y-6 animate-in fade-in">
                {/* INITIATION FORM - ONLY IF EDITABLE */}
                {canEdit && (
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-[#006a33] shadow-lg shadow-green-900/10">
                   <h3 className="text-[#006a33] text-xs font-black uppercase mb-4 italic tracking-widest">Loan Initiation</h3>
                   <div className="flex flex-col md:flex-row gap-4">
                      <select value={loanMemberId} onChange={(e) => setLoanMemberId(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs uppercase flex-1 outline-none focus:border-[#006a33] transition-colors">
                          <option value="">Select Borrower</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.member_name}</option>)}
                      </select>
                      <input type="number" placeholder="Principal Amount" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs w-full md:w-48 outline-none focus:border-[#006a33] transition-colors" />
                      <select value={loanDuration} onChange={(e) => setLoanDuration(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs w-full md:w-32 outline-none focus:border-[#006a33] transition-colors">
                          <option value="1">1 Month</option>
                          <option value="3">3 Months</option>
                          <option value="6">6 Months</option>
                      </select>
                      <button onClick={initiateLoan} disabled={isDisbursing} className="bg-[#006a33] text-white px-8 py-4 rounded-xl font-black uppercase text-[10px] hover:bg-white hover:text-black transition-all flex items-center justify-center min-w-[140px]">
                        {isDisbursing ? <Spinner /> : "Disburse Loan"}
                      </button>
                   </div>
                </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                   {loans.map(l => {
                      const totalDue = l.principal + (l.interest_accrued || 0);
                      const currentDebt = l.amount;
                      const totalRepaid = totalDue - currentDebt; 
                      const repaymentProgress = totalDue > 0 ? (totalRepaid / totalDue) * 100 : 0;
                      return (
                          <div key={l.id} className="bg-slate-900 p-6 rounded-[2rem] border border-slate-800 shadow-sm flex flex-col lg:flex-row justify-between items-center hover:border-slate-600 transition-all gap-6">
                             <div className="space-y-4 flex-1 w-full">
                                <div className="flex justify-between items-center">
                                    <div><p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Borrower</p><h4 className="text-xl font-black text-white uppercase">{l.members?.member_name || "Unknown"}</h4></div>
                                    <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border ${l.status === 'Paid' ? 'bg-green-900/20 text-green-400 border-green-800' : 'bg-blue-900/20 text-blue-400 border-blue-800'}`}>{l.status}</div>
                                </div>
                                <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800 relative"><div className="absolute inset-0 bg-slate-800/20" /><div className="bg-[#006a33] h-full transition-all duration-700 ease-out" style={{ width: `${repaymentProgress}%` }}></div></div>
                                <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400 font-mono">
                                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/50"><span className="block opacity-50 uppercase text-[9px]">Total Loan</span><span className="font-bold text-slate-200">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(totalDue)}</span></div>
                                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/50"><span className="block opacity-50 uppercase text-[9px]">Paid So Far</span><span className="font-bold text-green-400">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(totalRepaid)}</span>{totalRepaid > 0 && <span className="block text-[8px] text-slate-600 mt-1">Last: {l.last_repayment_date || 'N/A'}</span>}</div>
                                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/50"><span className="block opacity-50 uppercase text-[9px]">Remaining</span><span className="font-bold text-red-400">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(currentDebt)}</span></div>
                                </div>
                             </div>
                             
                             {/* REPAY BUTTON - ONLY IF EDITABLE */}
                             {canEdit && (
                             <div className="flex flex-col items-end gap-2 w-full lg:w-auto pl-0 lg:pl-6 border-t lg:border-t-0 lg:border-l border-slate-800 pt-4 lg:pt-0 mt-2 lg:mt-0">
                                {l.status !== 'Paid' ? (
                                    <button onClick={() => handleLoanRepayment(l.id, l.amount, l.members?.member_name || "")} className="w-full lg:w-auto px-8 py-4 bg-white text-black font-black uppercase text-[10px] rounded-xl hover:bg-slate-200 shadow-lg shadow-white/10 transition-transform active:scale-95">Repay Loan</button>
                                ) : (<span className="text-green-500 font-black uppercase text-xs tracking-widest bg-green-900/10 px-4 py-2 rounded-xl border border-green-900/30">✓ Fully Settled</span>)}
                             </div>
                             )}
                          </div>
                      );
                   })}
                </div>
             </div>
          )}

          {/* PRESENTATION */}
          {activeTab === "Presentation" && (
             <div className="space-y-6 animate-in fade-in">
                 <div className="flex justify-between items-end">
                     <div>
                        <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Ledger Period:</p>
                        <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="bg-black text-white p-3 rounded-xl text-xs font-bold uppercase border border-slate-700 outline-none focus:border-green-600 transition-colors"/>
                     </div>
                     <button onClick={handleDownloadMonthReport} className="bg-white text-black px-6 py-3 rounded-xl font-black uppercase text-[10px] hover:bg-slate-200 transition-colors">Download Ledger (PDF)</button>
                 </div>
                 <div className="bg-black/40 border border-slate-800 rounded-[2.5rem] overflow-hidden backdrop-blur-md shadow-2xl">
                     <div className="bg-slate-900/80 p-8 text-center border-b border-slate-800"><h2 className="text-2xl font-black text-[#006a33] uppercase tracking-widest">General Ledger</h2><p className="text-slate-400 font-mono text-sm mt-1">{reportMonth}</p></div>
                     <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
                         <div className="flex-1 flex flex-col">
                             <div className="p-4 bg-slate-900/50 border-b border-slate-800 text-center"><h4 className="text-green-500 font-black text-xs uppercase tracking-widest">DR (Receipts / In)</h4></div>
                             <div className="p-4 space-y-4 flex-1 min-h-[300px]">
                                 {ledger.drTrans.map((t, i) => (<div key={i} className="flex justify-between items-start border-b border-slate-800/50 pb-2"><div><span className="block text-[9px] text-slate-500 font-mono">{t.created_at.split('T')[0]}</span><span className="text-[10px] font-black text-slate-200 uppercase">{t.description}</span></div><span className="text-xs font-black text-green-400">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(t.amount)}</span></div>))}
                             </div>
                             <div className="bg-black p-6 border-t border-slate-800 flex justify-between items-center"><span className="text-xs font-bold text-slate-500 uppercase">Total DR</span><span className="text-xl font-black text-white">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(ledger.grandTotal)}</span></div>
                         </div>
                         <div className="flex-1 flex flex-col">
                             <div className="p-4 bg-slate-900/50 border-b border-slate-800 text-center"><h4 className="text-red-500 font-black text-xs uppercase tracking-widest">CR (Payments / Out)</h4></div>
                             <div className="p-4 space-y-4 flex-1 min-h-[300px]">
                                 {ledger.crTrans.map((t, i) => (<div key={i} className="flex justify-between items-start border-b border-slate-800/50 pb-2"><div><span className="block text-[9px] text-slate-500 font-mono">{t.created_at.split('T')[0]}</span><span className="text-[10px] font-black text-slate-200 uppercase">{t.description}</span></div><span className="text-xs font-black text-red-400">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Math.abs(t.amount))}</span></div>))}
                                 {ledger.balance >= 0 && (<div className="flex justify-between items-center py-3 border-t border-dotted border-green-900 mt-8"><span className="text-[10px] font-black text-green-500 uppercase italic">Balance c/d (Cash in Hand)</span><span className="text-xs font-black text-green-500">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(ledger.balance)}</span></div>)}
                             </div>
                             <div className="bg-black p-6 border-t border-slate-800 flex justify-between items-center"><span className="text-xs font-bold text-slate-500 uppercase">Total CR</span><span className="text-xl font-black text-white">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(ledger.grandTotal)}</span></div>
                         </div>
                     </div>
                 </div>
             </div>
          )}

          {/* SETTINGS - ONLY VISIBLE TO CHIEF OR READ ONLY */}
          {activeTab === "Settings" && (
             <div className="flex items-center justify-center h-full animate-in fade-in">
                 <div className="bg-slate-900 p-10 rounded-[2.5rem] border border-slate-800 shadow-2xl w-full max-w-xl">
                     <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-8">System Configuration</h3>
                     {canEdit ? (
                     <div className="space-y-6">
                         <div className="space-y-2"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Monthly Contribution (KES)</label><input type="number" value={tempConfig.contribution} onChange={(e) => setTempConfig({...tempConfig, contribution: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white p-4 rounded-xl font-bold text-lg outline-none focus:border-[#006a33] transition-colors" /></div>
                         <div className="space-y-2"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Late Payment Penalty (KES)</label><input type="number" value={tempConfig.lateFee} onChange={(e) => setTempConfig({...tempConfig, lateFee: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-red-400 p-4 rounded-xl font-bold text-lg outline-none focus:border-red-600 transition-colors" placeholder="e.g 500" /></div>
                         <div className="space-y-2"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Loan Interest Rate (%)</label><input type="number" value={tempConfig.interest} onChange={(e) => setTempConfig({...tempConfig, interest: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white p-4 rounded-xl font-bold text-lg outline-none focus:border-[#006a33] transition-colors" /></div>
                         <div className="pt-4"><button onClick={handleSaveSettings} disabled={isSavingSettings} className="w-full bg-[#006a33] hover:bg-white hover:text-black py-5 rounded-xl font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center">{isSavingSettings ? <Spinner /> : "Save Configuration"}</button></div>
                     </div>
                     ) : (
                         <div className="text-center p-8 bg-black/20 rounded-2xl border border-red-900/30">
                             <p className="text-red-400 font-bold uppercase text-xs">Access Restricted</p>
                             <p className="text-slate-500 text-[10px] mt-2">Only Chief or Treasurer can modify system core settings.</p>
                         </div>
                     )}
                 </div>
             </div>
          )}

        </div>
      </div>
    </main>
  );
}