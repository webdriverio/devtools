#!/usr/bin/env node
import { runShowTraceCli } from '@wdio/devtools-backend/show-trace'

void runShowTraceCli(process.argv.slice(2))
