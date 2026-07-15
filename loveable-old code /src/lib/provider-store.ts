// Simple localStorage-backed job store for the provider demo flow.
export type LineItem = { id: string; description: string; price: number };

export type Job = {
  id: string;
  photo: string | null;
  category: string;
  description: string;
  distance: number; // miles
  customerPrice: number;
  status: "available" | "active" | "pending_approval" | "approved" | "declined";
  addOns: LineItem[];
  customerAddress: string;
};

const KEY = "providerJobs";
const VERSION_KEY = "providerJobsVersion";
const VERSION = "2";

const SEED: Job[] = [];

export function loadJobs(): Job[] {
  if (typeof window === "undefined") return SEED;
  try {
    if (localStorage.getItem(VERSION_KEY) !== VERSION) {
      localStorage.setItem(VERSION_KEY, VERSION);
      localStorage.setItem(KEY, JSON.stringify(SEED));
      return SEED;
    }
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(KEY, JSON.stringify(SEED));
      return SEED;
    }
    return JSON.parse(raw) as Job[];
  } catch {
    return SEED;
  }
}

export function saveJobs(jobs: Job[]) {
  localStorage.setItem(KEY, JSON.stringify(jobs));
  window.dispatchEvent(new Event("provider-jobs-changed"));
}

export function updateJob(id: string, patch: Partial<Job>) {
  const jobs = loadJobs().map((j) => (j.id === id ? { ...j, ...patch } : j));
  saveJobs(jobs);
}

export function addJob(job: Omit<Job, "id" | "status" | "addOns"> & Partial<Pick<Job, "id" | "status" | "addOns">>) {
  const newJob: Job = {
    id: job.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `j${Date.now()}`),
    status: job.status ?? "available",
    addOns: job.addOns ?? [],
    photo: job.photo,
    category: job.category,
    description: job.description,
    distance: job.distance,
    customerPrice: job.customerPrice,
    customerAddress: job.customerAddress,
  };
  const jobs = [newJob, ...loadJobs()];
  saveJobs(jobs);
  return newJob;
}

// Platform takes 18% on the original customer price only. Add-ons go 100% to the provider.
export function payout(customerPrice: number) {
  return Math.round(customerPrice * 0.82);
}

export function addOnsTotal(job: Job) {
  return job.addOns.reduce((s, l) => s + (l.price || 0), 0);
}

export function jobTotal(job: Job) {
  return job.customerPrice + addOnsTotal(job);
}

export function providerPayout(job: Job) {
  return payout(job.customerPrice) + addOnsTotal(job);
}
