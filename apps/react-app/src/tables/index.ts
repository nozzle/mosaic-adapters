// src/tables/index.ts
// This file serves as a convenient entry point for exporting all table components.
import { AthletesTable } from './athletes/ui';
import { TripsTable } from './trips/ui';
import { VendorStatsTable } from './vendor/ui';
import { FlightsTable } from './flights/ui'; // Export the new FlightsTable
import { PrecinctStatsTable } from './precinctStats/ui';

export { AthletesTable, TripsTable, VendorStatsTable, FlightsTable, PrecinctStatsTable };