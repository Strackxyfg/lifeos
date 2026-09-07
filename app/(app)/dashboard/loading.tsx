export default function DashboardLoading() {
  return (
    <div className="animate-fade-up">
      <div className="mb-8 space-y-2">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="skeleton h-72 lg:col-span-2" />
        <div className="skeleton h-72" />
      </div>
    </div>
  );
}
