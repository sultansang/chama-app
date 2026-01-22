"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { 
  format, startOfYear, eachMonthOfInterval, isSameMonth, 
  isWithinInterval, startOfMonth, endOfMonth, parseISO, addMonths 
} from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// --- 🔒 CONSTANTS ---
const PROFILE_URL = "/me.jpg";

// --- ICONS (Inline SVGs) ---
const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
);
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 18 12"/></svg>
);

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [imgError, setImgError] = useState(false);

  // --- MOBILE SIDEBAR STATE ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // --- LOADING & UI STATES ---
  const [isRegistering, setIsRegistering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDisbursing, setIsDisbursing] = useState(false); 
  const [selectedMember, setSelectedMember] = useState<any>(null);

  // --- REPORTING STATE ---
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM')); 

  // --- DATA STATE ---
  const [config, setConfig] = useState<any>({ monthly_contribution: 4000, loan_interest_rate: 10 });
  const [members, setMembers] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  // --- INPUTS ---
  const [regName, setRegName] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [fineAmount, setFineAmount] = useState("");

  // --- LOAN INPUTS ---
  const [loanMemberId, setLoanMemberId] = useState("");
  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanDuration, setLoanDuration] = useState("1");
  
  // --- DATE CONSTANTS ---
  const today = new Date();
  const currentDay = today.getDate();
  const isSafeZone = currentDay >= 3 && currentDay <= 25;
  const startOfYearDate = startOfYear(today);
  const monthsList = eachMonthOfInterval({ start: startOfYearDate, end: today });

  useEffect(() => { setMounted(true); }, []);

  // --- ⚡ OPTIMIZED DATA SYNC ---
  const syncAllData = useCallback(async () => {
    const { data: settings } = await supabase.from('settings').select('*').single();
    if (settings) setConfig(settings);

    const [mRes, lRes, tRes] = await Promise.all([
        supabase.from('members').select('*').order('member_name', { ascending: true }),
        supabase.from('loans').select('*, members(member_name)').order('created_at', { ascending: false }),
        supabase.from('transactions').select('*').order('created_at', { ascending: false })
    ]);
    
    if (mRes.data) setMembers(mRes.data);
    if (lRes.data) setLoans(lRes.data);
    if (tRes.data) setTransactions(tRes.data);
  }, []);

  useEffect(() => {
    if (mounted && authenticated) syncAllData();
  }, [mounted, authenticated, syncAllData]);

  // Keep selectedMember fresh
  useEffect(() => {
    if (selectedMember && members.length > 0) {
        const freshData = members.find((m) => m.id === selectedMember.id);
        if (freshData && JSON.stringify(freshData) !== JSON.stringify(selectedMember)) {
            setSelectedMember(freshData);
        }
    }
  }, [members, selectedMember]);


  // --- 🧮 FINANCIALS ---
  const getMemberFinancials = useCallback((member: any) => {
    if (!member) return { netBalance: 0, totalPaid: 0, totalExpected: 0, breakdown: [] };

    const totalPaid = member.carry_forward || 0;
    let cumulativeExpected = 0;
    const breakdown: any[] = [];

    monthsList.forEach((date) => {
        const monthName = format(date, 'MMMM');
        const isCurrentMonth = isSameMonth(date, today);
        const expectedThisMonth = config.monthly_contribution;
        cumulativeExpected += expectedThisMonth;

        const netBalanceAtMonth = totalPaid - cumulativeExpected;
        let status = netBalanceAtMonth >= 0 ? 'Clear' : (isCurrentMonth ? 'Pending' : 'Arrears');

        breakdown.push({
            month: monthName,
            expected: expectedThisMonth,
            balanceRunning: netBalanceAtMonth,
            status: status,
            isPast: !isCurrentMonth
        });
    });

    return {
        netBalance: totalPaid - cumulativeExpected,
        totalPaid,
        totalExpected: cumulativeExpected,
        breakdown
    };
  }, [config.monthly_contribution, monthsList]);


  // --- 📄 PDF DOWNLOADER (INDIVIDUAL) ---
  const handleDownloadMemberHistory = (member: any) => {
     const memLoans = loans.filter(l => l.member_id === member.id).map(l => ({
         date: l.created_at.split('T')[0],
         type: 'LOAN TAKEN',
         amount: l.principal,
         details: `Status: ${l.status} | Due: ${l.due_date}`
     }));

     const memTrans = transactions.filter(t => t.description.includes(member.member_name)).map(t => ({
         date: t.created_at.split('T')[0],
         type: t.type.toUpperCase(),
         amount: t.amount,
         details: t.description
     }));

     const combined = [...memLoans, ...memTrans].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

     const doc = new jsPDF();
     doc.setFontSize(18);
     doc.text(`Financial History Report`, 14, 20);
     doc.setFontSize(12);
     doc.text(`Member: ${member.member_name}`, 14, 28);
     doc.text(`Date Generated: ${new Date().toISOString().split('T')[0]}`, 14, 34);

     const tableBody = combined.map(row => [
         row.date,
         row.type,
         row.amount.toLocaleString() + ' KES',
         row.details
     ]);

     autoTable(doc, {
         startY: 40,
         head: [['Date', 'Activity Type', 'Amount', 'Details']],
         body: tableBody,
         theme: 'grid',
         headStyles: { fillColor: [0, 106, 51] },
     });

     doc.save(`${member.member_name}_History.pdf`);
  };

  // --- 📄 PDF DOWNLOADER (MONTHLY REPORT) ---
  const handleDownloadMonthReport = () => {
    const targetDate = parseISO(reportMonth + "-01");
    const start = startOfMonth(targetDate);
    const end = endOfMonth(targetDate);

    const monthlyData = transactions.filter(t => 
        isWithinInterval(parseISO(t.created_at), { start, end })
    ).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`Monthly Ledger Report`, 14, 20);
    doc.setFontSize(12);
    doc.text(`Period: ${format(targetDate, 'MMMM yyyy')}`, 14, 28);
    
    // Calculate Ledger Totals
    const debits = monthlyData.filter(t => t.amount > 0).reduce((acc, t) => acc + t.amount, 0);
    const credits = monthlyData.filter(t => t.amount < 0).reduce((acc, t) => acc + Math.abs(t.amount), 0);
    const balance = debits - credits;

    const tableBody = monthlyData.map(t => [
        t.created_at.split('T')[0],
        t.description,
        t.amount > 0 ? t.amount.toLocaleString() : '-',
        t.amount < 0 ? Math.abs(t.amount).toLocaleString() : '-'
    ]);

    autoTable(doc, {
        startY: 40,
        head: [['Date', 'Description', 'Debit (In)', 'Credit (Out)']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [0, 106, 51] },
        foot: [['', 'Totals', debits.toLocaleString(), credits.toLocaleString()]]
    });
    
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.text(`Net Closing Balance: KES ${balance.toLocaleString()}`, 14, finalY);

    doc.save(`Chama_Ledger_${reportMonth}.pdf`);
  };


  // --- 🟢 KPI CALCULATOR ---
  const getPresentationKPIs = () => {
    const targetDate = parseISO(reportMonth + "-01");
    const start = startOfMonth(targetDate);
    const end = endOfMonth(targetDate);

    const monthTrans = transactions.filter(t => isWithinInterval(parseISO(t.created_at), { start, end }));
    
    const drTrans = monthTrans.filter(t => t.amount > 0); 
    const crTrans = monthTrans.filter(t => t.amount < 0); 

    const totalDr = drTrans.reduce((acc, t) => acc + t.amount, 0);
    const totalCr = crTrans.reduce((acc, t) => acc + Math.abs(t.amount), 0);
    
    const balance = totalDr - totalCr;
    // For T-Account balancing, the Grand Total is always the larger side
    const grandTotal = Math.max(totalDr, totalCr); 

    return { drTrans, crTrans, totalDr, totalCr, balance, grandTotal };
  };

  const ledger = getPresentationKPIs();

  // --- ACTIONS ---
  const handlePayment = async () => {
    if (!paymentAmount || !selectedMember) return;
    const amount = Number(paymentAmount);
    setIsProcessing(true);

    const newBalance = (selectedMember.carry_forward || 0) + amount;
    const { error } = await supabase.from('members').update({ carry_forward: newBalance }).eq('id', selectedMember.id);

    if (!error) {
        await supabase.from('transactions').insert([{ amount, type: 'Deposit', description: `Payment: ${selectedMember.member_name}` }]);
        setPaymentAmount(""); await syncAllData(); alert("Payment Processed");
    }
    setIsProcessing(false);
  };

  const handleApplyFine = async (monthName: string) => {
    if (!fineAmount) return alert("Enter fine amount.");
    const fine = Number(fineAmount);
    if(!confirm(`Apply fine of KES ${fine} to ${selectedMember.member_name}?`)) return;
    setIsProcessing(true);
    const newBalance = (selectedMember.carry_forward || 0) - fine; 
    const { error } = await supabase.from('members').update({ carry_forward: newBalance }).eq('id', selectedMember.id);
    if (!error) {
        await supabase.from('transactions').insert([{ amount: fine, type: 'Fine', description: `Fine: ${monthName} - ${selectedMember.member_name}` }]);
        setFineAmount(""); await syncAllData(); alert("Fine Applied.");
    }
    setIsProcessing(false);
  };

  const initiateLoan = async () => {
    if (!loanMemberId || !loanPrincipal) return;
    const borrower = members.find(m => m.id == loanMemberId); 
    if (!borrower) return;

    setIsDisbursing(true);
    const principal = Number(loanPrincipal);
    const interest = principal * (config.loan_interest_rate / 100);
    const dueDate = addMonths(new Date(), Number(loanDuration));

    const { error } = await supabase.from('loans').insert([{
      member_id: loanMemberId,
      amount: principal + interest,
      principal: principal,
      interest_accrued: interest,
      status: 'Active',
      due_date: dueDate.toISOString().split('T')[0],
      created_at: new Date().toISOString()
    }]);

    if (!error) {
      await supabase.from('transactions').insert([{ amount: -principal, type: 'Loan Issuance', description: `Disbursed to ${borrower.member_name}` }]);
      setLoanPrincipal(""); await syncAllData(); alert(`Loan disbursed to ${borrower.member_name}!`);
    }
    setIsDisbursing(false);
  };

  const handleLoanRepayment = async (loanId: string, currentBalance: number, memberName: string) => {
    const amountStr = prompt(`Repayment for ${memberName} (Bal: ${currentBalance}):`);
    if (!amountStr) return;
    const repayment = Number(amountStr);
    const newBalance = currentBalance - repayment;
    const newStatus = newBalance <= 0 ? 'Paid' : 'Active';
    
    const { error } = await supabase.from('loans').update({ 
        amount: newBalance, status: newStatus, last_repayment_date: new Date().toISOString().split('T')[0] 
    }).eq('id', loanId);

    if (!error) {
      await supabase.from('transactions').insert([{ amount: repayment, type: 'Loan Repayment', description: `Loan Repayment: ${memberName}` }]);
      await syncAllData(); alert(`Repayment recorded for ${memberName}!`);
    }
  };

  // --- RENDER ---
  if (!mounted) return null;

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-900/40 via-black to-black animate-pulse-slow pointer-events-none"></div>
        <div className="w-full max-w-sm bg-slate-900/80 backdrop-blur-xl p-10 rounded-[2rem] shadow-2xl border border-slate-800 text-center flex flex-col justify-between min-h-[600px] relative z-10">
          <div className="flex-1 flex flex-col justify-center">
             <div className="mb-10">
                <div className="h-28 w-28 bg-black rounded-2xl border border-slate-700 mx-auto flex items-center justify-center mb-8 overflow-hidden p-1 shadow-2xl shadow-green-900/20">
                    <img src={imgError ? "https://ui-avatars.com/api/?name=Admin&background=006a33&color=fff" : PROFILE_URL} onError={() => setImgError(true)} alt="Admin" className="h-full w-full object-cover rounded-xl" />
                </div>
                <h1 className="text-white text-3xl font-black italic tracking-tighter mb-2">MONEY<span className="text-[#006a33]">VAULT</span></h1>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.4em]">Restricted Access</p>
             </div>
             <div className="space-y-6">
                <div className="bg-black/50 rounded-xl border border-slate-800 p-2">
                    <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
                        className="w-full bg-transparent border-none p-4 text-center text-4xl text-white tracking-[0.5em] outline-none font-mono placeholder-slate-700"
                        placeholder="••••" maxLength={4} />
                </div>
                <button onClick={() => pin === "7777" ? setAuthenticated(true) : alert("INVALID PIN")} 
                    className="w-full bg-[#006a33] hover:bg-[#005228] py-5 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transition-all">
                    Unlock Terminal
                </button>
             </div>
          </div>
        </div>
      </main>
    );
  }

  // --- DETAIL MEMBER MODAL (DARK MODE) ---
  if (selectedMember && activeTab === "Members") {
    const fin = getMemberFinancials(selectedMember);
    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm p-6">
            <div className="bg-slate-900 w-full max-w-5xl h-[90vh] rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl border border-slate-800 animate-in zoom-in-95 relative">
                
                <button onClick={(e) => { e.stopPropagation(); setSelectedMember(null); }} 
                    className="absolute top-6 right-6 z-20 h-10 w-10 bg-slate-800 hover:bg-red-900 text-white rounded-full flex items-center justify-center transition-all">✕</button>

                <div className="bg-slate-950 p-8 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <div>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedMember(null); }} className="text-[10px] text-slate-400 font-black uppercase tracking-widest hover:text-white mb-2">← Back</button>
                        <h2 className="text-3xl font-black uppercase italic text-white">{selectedMember.member_name}</h2>
                        <div className="flex gap-4 mt-2">
                             <div className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700">
                                 <span className="text-[9px] uppercase text-slate-400 block">Net Balance</span>
                                 <span className={`text-lg font-black ${fin.netBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>KES {fin.netBalance.toLocaleString()}</span>
                             </div>
                             <button onClick={() => handleDownloadMemberHistory(selectedMember)} className="px-3 py-1 bg-[#006a33] text-white rounded-lg text-[10px] font-black uppercase hover:bg-green-600 transition-colors">
                                 Download History (PDF) ⬇
                             </button>
                        </div>
                    </div>
                    <div className="bg-slate-800 p-4 rounded-2xl w-72 border border-slate-700">
                        <p className="text-slate-400 text-[10px] font-black uppercase mb-2">Process Payment</p>
                        <div className="flex gap-2">
                            <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} 
                                className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded-lg font-bold text-sm outline-none placeholder-slate-600" placeholder="KES" />
                            <button onClick={handlePayment} disabled={isProcessing} className="bg-white text-black px-4 rounded-lg font-black text-[10px] uppercase hover:bg-slate-200">
                                {isProcessing ? "..." : "PAY"}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 bg-slate-900">
                    <h3 className="text-slate-500 font-black text-xs uppercase tracking-widest mb-4">Financial Ledger ({today.getFullYear()})</h3>
                    <div className="space-y-3">
                        {fin.breakdown.map((record: any, idx: number) => (
                            <div key={idx} className={`p-5 rounded-2xl border flex items-center justify-between ${record.balanceRunning < 0 ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-800/50 border-slate-800'}`}>
                                <div className="w-32">
                                    <h4 className="font-bold text-slate-200 uppercase text-sm">{record.month}</h4>
                                    <p className="text-[9px] text-slate-500">Exp: {record.expected}</p>
                                </div>
                                <div className="flex-1 px-4">
                                     <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${record.balanceRunning < 0 ? 'bg-red-900/20 text-red-400' : 'bg-green-900/20 text-green-400'}`}>
                                          {record.balanceRunning < 0 ? `Deficit: ${Math.abs(record.balanceRunning)}` : 'Cleared / Surplus'}
                                     </span>
                                </div>
                                {record.balanceRunning < 0 && record.isPast && (
                                    <div className="flex gap-2">
                                        <input type="number" placeholder="Fine" onChange={(e) => setFineAmount(e.target.value)} 
                                            className="w-20 bg-slate-950 border border-slate-700 p-2 rounded-lg text-[10px] text-white font-bold outline-none" />
                                        <button onClick={() => handleApplyFine(record.month)} className="bg-red-600 text-white px-3 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-red-500">Apply Fine</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
  }

  // --- MAIN LAYOUT ---
  return (
    <main className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
      
      {/* 1. MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* 2. SIDEBAR */}
      <aside className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-[#051b11] flex flex-col border-r border-slate-800 
          transform transition-transform duration-300 ease-out
          lg:translate-x-0 lg:static
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-8 flex justify-between items-center">
          <h1 className="text-white text-2xl font-black italic tracking-tighter uppercase">Chama<span className="text-[#006a33]">Pro</span></h1>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white p-2">
             <CloseIcon />
          </button>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          {["Dashboard", "Members", "Monthly Log", "Loan Manager", "Presentation"].map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); setIsSidebarOpen(false); }}
              className={`w-full flex items-center px-6 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab ? 'bg-[#006a33] text-white shadow-lg shadow-green-900/20 translate-x-2' : 'text-slate-500 hover:text-white hover:bg-white/5'
              }`}>
              {tab}
            </button>
          ))}
        </nav>
      </aside>

      {/* 3. MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative z-0">
        {/* HEADER */}
        <header className="h-20 bg-slate-900/50 backdrop-blur-md border-b border-slate-800 px-6 lg:px-8 flex justify-between items-center shrink-0">
           <div className="flex items-center gap-4">
               {/* HAMBURGER MENU */}
               <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-white bg-slate-800 p-2 rounded-lg hover:bg-slate-700">
                  <MenuIcon />
               </button>
               <h2 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.5em]">{activeTab} Terminal</h2>
           </div>
           
           <div className="h-8 w-8 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                <img src={PROFILE_URL} alt="User" className="h-full w-full object-cover" onError={(e:any) => e.target.style.display='none'}/>
           </div>
        </header>

        <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
          
          {/* DASHBOARD VIEW */}
          {activeTab === "Dashboard" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in">
                <div className="bg-slate-900 p-8 rounded-[2rem] shadow-lg border border-slate-800">
                    <p className="text-slate-500 text-[9px] font-black uppercase mb-1">Total Liquidity</p>
                    <h3 className="text-3xl font-black text-white">KES {transactions.reduce((acc,t)=>acc+t.amount,0).toLocaleString()}</h3>
                </div>
                <div className="bg-slate-900 p-8 rounded-[2rem] shadow-lg border border-slate-800">
                    <p className="text-slate-500 text-[9px] font-black uppercase mb-1">Active Loans</p>
                    <h3 className="text-3xl font-black text-blue-400">KES {loans.filter(l=>l.status!=='Paid').reduce((acc,l)=>acc+l.amount,0).toLocaleString()}</h3>
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

                    <div className="relative z-10 text-right hidden md:block">
                        <div className={`inline-block px-6 py-2 rounded-full font-black uppercase text-xs mb-2 shadow-lg ${isSafeZone ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                            {isSafeZone ? 'Safe Zone (3rd - 25th)' : 'Due / Late Zone'}
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900 rounded-[2.5rem] p-8 shadow-sm border border-slate-800">
                    <h3 className="text-slate-400 text-xs font-black uppercase mb-6">Member Status Grid</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {members.map(m => {
                            const fin = getMemberFinancials(m);
                            const currentMonthName = format(today, 'MMMM');
                            const isPending = fin.breakdown.find((b: any) => b.month === currentMonthName)?.balanceRunning < 0;
                            const isCleared = !isPending;

                            return (
                                <div key={m.id} className={`p-5 rounded-2xl border-l-4 shadow-sm flex flex-col justify-between h-32 ${isPending ? 'bg-red-950/20 border-red-600' : 'bg-green-950/20 border-green-600'}`}>
                                    <div>
                                        <p className="text-xs font-black uppercase truncate text-white">{m.member_name}</p>
                                        <p className="text-[10px] font-bold text-slate-500 mt-1">
                                            Paid: <span className="text-slate-300">KES {fin.totalPaid.toLocaleString()}</span>
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className={`text-[10px] font-black uppercase ${isCleared ? 'text-green-500' : 'text-red-500'}`}>
                                            {isCleared ? `Cleared` : `Pending`}
                                        </p>
                                        <div className="bg-slate-950/50 p-1 rounded">
                                             <p className={`text-[10px] font-bold ${fin.netBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                  Bal: {fin.netBalance >= 0 ? '+' : ''}{fin.netBalance.toLocaleString()}
                                             </p>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
          )}

          {/* MEMBERS VIEW */}
          {activeTab === "Members" && (
             <div className="space-y-6 animate-in slide-in-from-bottom-4">
                <div className="bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-800 flex gap-4">
                   <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} 
                       className="flex-1 bg-slate-950 border border-slate-800 text-white p-4 rounded-xl font-black uppercase text-xs outline-none focus:border-[#006a33]" placeholder="New Member Full Name" />
                   <button onClick={async () => {
                       if(!regName) return;
                       setIsRegistering(true);
                       await supabase.from('members').insert([{ member_name: regName.toUpperCase(), carry_forward: 0, joined_at: new Date().toISOString() }]);
                       setRegName(""); await syncAllData(); setIsRegistering(false);
                   }} disabled={isRegistering} className="bg-[#006a33] text-white px-8 rounded-xl font-black uppercase text-[10px] hover:bg-white hover:text-black transition-all">Add</button>
                </div>

                <div className="bg-slate-900 rounded-[2.5rem] shadow-lg overflow-hidden border border-slate-800">
                   <table className="w-full text-left">
                      <thead className="bg-slate-950 text-[10px] font-black text-slate-500 uppercase">
                          <tr><th className="p-6 pl-8">Name</th><th className="p-6">Rolling Balance</th><th className="p-6 text-right">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                         {members.map(m => {
                            const fin = getMemberFinancials(m);
                            return (
                                <tr key={m.id} className="hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => setSelectedMember(m)}>
                                <td className="p-6 pl-8 font-black uppercase text-slate-200">{m.member_name}</td>
                                <td className="p-6">
                                    <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${fin.netBalance >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                                         {fin.netBalance >= 0 ? '+' : ''} KES {fin.netBalance.toLocaleString()}
                                    </span>
                                </td>
                                <td className="p-6 text-right"><span className="text-[10px] font-bold text-slate-500 uppercase group-hover:text-white">View Profile</span></td>
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
                {/* INITIATION FORM */}
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-[#006a33] shadow-lg shadow-green-900/10">
                   <h3 className="text-[#006a33] text-xs font-black uppercase mb-4 italic">Loan Initiation</h3>
                   <div className="flex flex-col md:flex-row gap-4">
                      <select value={loanMemberId} onChange={(e) => setLoanMemberId(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs uppercase flex-1 outline-none focus:border-[#006a33]">
                          <option value="">Select Borrower</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.member_name}</option>)}
                      </select>
                      <input type="number" placeholder="Principal Amount" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs w-full md:w-48 outline-none focus:border-[#006a33]" />
                      <select value={loanDuration} onChange={(e) => setLoanDuration(e.target.value)} className="bg-slate-950 text-white border border-slate-800 p-4 rounded-xl font-black text-xs w-full md:w-32 outline-none">
                          <option value="1">1 Month</option>
                          <option value="3">3 Months</option>
                          <option value="6">6 Months</option>
                      </select>
                      <button onClick={initiateLoan} disabled={isDisbursing} className="bg-[#006a33] text-white px-8 py-4 rounded-xl font-black uppercase text-[10px] hover:bg-white hover:text-black transition-all">
                        {isDisbursing ? "..." : "Disburse Loan"}
                      </button>
                   </div>
                </div>

                {/* LOAN LIST */}
                <div className="grid grid-cols-1 gap-4">
                   {loans.map(l => {
                      const totalDue = l.principal + (l.interest_accrued || 0);
                      const rate = l.principal > 0 ? ((l.interest_accrued / l.principal) * 100).toFixed(1) : 0;
                      
                      return (
                          <div key={l.id} className="bg-slate-900 p-6 rounded-[2rem] border border-slate-800 shadow-sm flex flex-col lg:flex-row justify-between items-center hover:border-slate-600 transition-all gap-4">
                             <div className="space-y-2 flex-1 w-full">
                                <div>
                                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Borrower</p>
                                    <h4 className="text-xl font-black text-white uppercase">{l.members?.member_name || "Unknown Member"}</h4>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-[10px] text-slate-400 font-mono border-t border-slate-800 pt-3 mt-1">
                                    <div><span className="block opacity-50 uppercase">Principal</span><span className="font-bold text-slate-200">KES {l.principal.toLocaleString()}</span></div>
                                    <div><span className="block opacity-50 uppercase">Interest ({rate}%)</span><span className="font-bold text-red-400">KES {l.interest_accrued.toLocaleString()}</span></div>
                                    <div><span className="block opacity-50 uppercase">Total Due</span><span className="font-bold text-white">KES {totalDue.toLocaleString()}</span></div>
                                    <div><span className="block opacity-50 uppercase">Status</span><span className={`font-bold uppercase ${l.status === 'Paid' ? 'text-green-500' : 'text-blue-500'}`}>{l.status}</span></div>
                                </div>
                             </div>
                             <div className="flex flex-col items-end gap-2 w-full lg:w-auto">
                                <span className="text-xs font-black text-slate-500 uppercase">Balance: KES {l.amount.toLocaleString()}</span>
                                {l.status !== 'Paid' && (
                                    <button onClick={() => handleLoanRepayment(l.id, l.amount, l.members?.member_name)} className="w-full lg:w-auto px-6 py-3 bg-white text-black font-black uppercase text-[10px] rounded-xl hover:bg-slate-200">
                                        Repay
                                    </button>
                                )}
                             </div>
                          </div>
                      );
                   })}
                </div>
             </div>
          )}

          {/* --- PRESENTATION (LEDGER T-ACCOUNT STYLE) --- */}
          {activeTab === "Presentation" && (
             <div className="space-y-6 animate-in fade-in">
                 
                 {/* Top Controls */}
                 <div className="flex justify-between items-end">
                     <div>
                        <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Ledger Period:</p>
                        <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} 
                             className="bg-black text-white p-3 rounded-xl text-xs font-bold uppercase border border-slate-700 outline-none focus:border-green-600"/>
                     </div>
                     <button onClick={handleDownloadMonthReport} className="bg-white text-black px-6 py-3 rounded-xl font-black uppercase text-[10px] hover:bg-slate-200">
                             Download Ledger (PDF)
                     </button>
                 </div>

                 {/* THE T-ACCOUNT LEDGER */}
                 <div className="bg-black/40 border border-slate-800 rounded-[2.5rem] overflow-hidden backdrop-blur-md shadow-2xl">
                     
                     {/* 1. TITLE HEADER */}
                     <div className="bg-slate-900/80 p-8 text-center border-b border-slate-800">
                        <h2 className="text-2xl font-black text-[#006a33] uppercase tracking-widest">General Ledger</h2>
                        <p className="text-slate-400 font-mono text-sm mt-1">{reportMonth}</p>
                     </div>

                     {/* 2. COLUMNS WRAPPER (STACK on Mobile, SPLIT on Desktop) */}
                     <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
                         
                         {/* --- LEFT COLUMN: DR (RECEIPTS) --- */}
                         <div className="flex-1 flex flex-col">
                             <div className="p-4 bg-slate-900/50 border-b border-slate-800 text-center">
                                 <h4 className="text-green-500 font-black text-xs uppercase tracking-widest">DR (Receipts / In)</h4>
                             </div>
                             
                             <div className="p-4 space-y-4 flex-1 min-h-[300px]">
                                 {/* Map Incoming Transactions */}
                                 {ledger.drTrans.map((t, i) => (
                                     <div key={i} className="flex justify-between items-start border-b border-slate-800/50 pb-2">
                                         <div>
                                            <span className="block text-[9px] text-slate-500 font-mono">{t.created_at.split('T')[0]}</span>
                                            <span className="text-[10px] font-black text-slate-200 uppercase">{t.description}</span>
                                         </div>
                                         <span className="text-xs font-black text-green-400">KES {t.amount.toLocaleString()}</span>
                                     </div>
                                 ))}
                             </div>

                             {/* DR FOOTER */}
                             <div className="bg-black p-6 border-t border-slate-800 flex justify-between items-center">
                                 <span className="text-xs font-bold text-slate-500 uppercase">Total DR</span>
                                 <span className="text-xl font-black text-white">KES {ledger.grandTotal.toLocaleString()}</span>
                             </div>
                         </div>

                         {/* --- RIGHT COLUMN: CR (PAYMENTS) --- */}
                         <div className="flex-1 flex flex-col">
                             <div className="p-4 bg-slate-900/50 border-b border-slate-800 text-center">
                                 <h4 className="text-red-500 font-black text-xs uppercase tracking-widest">CR (Payments / Out)</h4>
                             </div>

                             <div className="p-4 space-y-4 flex-1 min-h-[300px]">
                                 {/* Map Outgoing Transactions */}
                                 {ledger.crTrans.map((t, i) => (
                                     <div key={i} className="flex justify-between items-start border-b border-slate-800/50 pb-2">
                                         <div>
                                            <span className="block text-[9px] text-slate-500 font-mono">{t.created_at.split('T')[0]}</span>
                                            <span className="text-[10px] font-black text-slate-200 uppercase">{t.description}</span>
                                         </div>
                                         <span className="text-xs font-black text-red-400">KES {Math.abs(t.amount).toLocaleString()}</span>
                                     </div>
                                 ))}

                                 {/* --- THE BALANCING FIGURE (CASH IN HAND) --- */}
                                 {/* We place this on the CR side so the totals match visually */}
                                 {ledger.balance >= 0 && (
                                     <div className="flex justify-between items-center py-3 border-t border-dotted border-green-900 mt-8">
                                         <span className="text-[10px] font-black text-green-500 uppercase italic">Balance c/d (Cash in Hand)</span>
                                         <span className="text-xs font-black text-green-500">KES {ledger.balance.toLocaleString()}</span>
                                     </div>
                                 )}
                             </div>

                             {/* CR FOOTER */}
                             <div className="bg-black p-6 border-t border-slate-800 flex justify-between items-center">
                                 <span className="text-xs font-bold text-slate-500 uppercase">Total CR</span>
                                 <span className="text-xl font-black text-white">KES {ledger.grandTotal.toLocaleString()}</span>
                             </div>
                         </div>

                     </div>
                 </div>
             </div>
          )}

        </div>
      </div>
    </main>
  );
}