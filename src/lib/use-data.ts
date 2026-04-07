"use client";

import { useState, useEffect, useCallback } from "react";

interface Teacher {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  createdAt: string;
  schoolId: number;
}

interface School {
  id: number;
  name: string;
  nameEn: string | null;
  code: string;
  domain: string | null;
  region: string | null;
  team: string | null;
  teacherCount: number;
  teachers: Teacher[];
}

// Global client-side cache
let _cache: { data: School[]; timestamp: number } | null = null;
let _promise: Promise<School[]> | null = null;
const CLIENT_CACHE_TTL = 20_000; // 20 seconds

async function fetchSchools(): Promise<School[]> {
  const res = await fetch("/api/schools?include=teachers");
  return res.json();
}

export function useSchoolData() {
  const [schools, setSchools] = useState<School[]>(_cache?.data || []);
  const [loading, setLoading] = useState(!_cache);

  const load = useCallback(async (force = false) => {
    // Return cache if fresh
    if (!force && _cache && Date.now() - _cache.timestamp < CLIENT_CACHE_TTL) {
      setSchools(_cache.data);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent requests
    if (!_promise) {
      _promise = fetchSchools().finally(() => { _promise = null; });
    }

    setLoading(true);
    const data = await _promise;
    _cache = { data, timestamp: Date.now() };
    setSchools(data);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    _cache = null;
    return load(true);
  }, [load]);

  useEffect(() => { load(); }, [load]);

  return { schools, loading, refresh };
}

export type { School, Teacher };
