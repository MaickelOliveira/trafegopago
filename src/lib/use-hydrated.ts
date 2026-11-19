"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const ready = () => true;
const server = () => false;
export function useHydrated() { return useSyncExternalStore(subscribe, ready, server); }
