import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import ExportPanel from "../../components/ExportPanel";
import Overview from "./Overview";
import Coaches from "./Coaches";
import RulesEditor from "./RulesEditor";
import Settings from "./Settings";
import Families from "../coach/Families";
import FamilyDetail from "../coach/FamilyDetail";

function AdminExport() {
  return (
    <Layout nav={ADMIN_NAV} title="Export data">
      <ExportPanel scope="admin" />
    </Layout>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="coaches" element={<Coaches />} />
      <Route path="rules" element={<RulesEditor />} />
      <Route path="export" element={<AdminExport />} />
      <Route path="settings" element={<Settings />} />
      {/* Admins reuse the coach screens; the data layer widens their scope. */}
      <Route path="families" element={<Families />} />
      <Route path="family/:familyId" element={<FamilyDetail />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
