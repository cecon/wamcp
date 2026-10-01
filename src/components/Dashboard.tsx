import {
  ArrowUpRight,
  ChevronRight,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import type { Session } from '../types';
import { Status } from '../ui';
export function Dashboard({
  sessions,
  onCreate,
  onSelect,
}: {
  sessions: Session[];
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const connected = sessions.filter((s) => s.status === 'connected').length;
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">SEU WHATSAPP, CONECTADO À IA</span>
          <h1>Minhas sessões</h1>
          <p>Conecte suas contas e transforme conversas em possibilidades.</p>
        </div>
        <button className="primary" onClick={() => onCreate()}>
          <Plus size={18} />
          Nova sessão
        </button>
      </div>
      <div className="stats">
        <div>
          <span>
            Sessões criadas
            <LayoutDashboard size={19} />
          </span>
          <strong>{sessions.length.toString().padStart(2, '0')}</strong>
          <small>Contas no seu workspace</small>
        </div>
        <div>
          <span>
            Conectadas
            <Radio size={19} />
          </span>
          <strong>
            {connected.toString().padStart(2, '0')}
            <i className="online-dot" />
          </strong>
          <small>Prontas para receber conexões</small>
        </div>
        <div>
          <span>
            Mensagens sincronizadas
            <MessageSquare size={19} />
          </span>
          <strong>{sessions.reduce((n, s) => n + (s.message_count || 0), 0).toLocaleString('pt-BR')}</strong>
          <small>Armazenadas no seu computador</small>
        </div>
      </div>
      <div className="section-heading">
        <h2>
          Suas conexões <span>{sessions.length}</span>
        </h2>
        <span>Gerencie cada conta de forma independente</span>
      </div>
      <div className="sessions-grid">
        {sessions.map((s) => (
          <button className="session-card" key={s.id} onClick={() => onSelect(s.id)}>
            <div className="card-top">
              <div className="session-icon">
                <MessageSquare size={25} />
              </div>
              <Status value={s.status} />
            </div>
            <h3>{s.name}</h3>
            <p>{s.phone ? `+${s.phone}` : 'Nenhum número conectado'}</p>
            <div className="card-divider" />
            <div className="card-footer">
              <span>
                <ShieldCheck size={15} />
                MCP por sessão
              </span>
              <span>
                Abrir sessão
                <ArrowUpRight size={17} />
              </span>
            </div>
          </button>
        ))}
        <button className="add-card" onClick={() => onCreate()}>
          <span>
            <Plus size={24} />
          </span>
          <h3>Conectar uma conta</h3>
          <p>Uma nova sessão, novas possibilidades.</p>
        </button>
      </div>
      {sessions.length === 0 && (
        <div className="getting-started">
          <div className="step-number">01</div>
          <div>
            <h3>Seu primeiro passo começa aqui</h3>
            <p>Crie uma sessão, escaneie o QR Code e conecte sua ferramenta de IA pelo MCP.</p>
          </div>
          <ChevronRight size={24} />
        </div>
      )}
      <div className="local-note">
        <ShieldCheck size={17} />
        <span>Conexões isoladas. Tokens individuais. Você controla quem tem acesso.</span>
      </div>
    </>
  );
}
