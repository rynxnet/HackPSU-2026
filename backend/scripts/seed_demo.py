import asyncio
from uuid import uuid4
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import settings
from app.models.user import User
from app.models.project import Project
from app.models.paper import Paper, PaperSection, PaperChunk
from app.models.dataset import Dataset
from app.models.draft import Draft
from app.models.chat import ChatSession, ChatMessage
from app.utils.security import get_password_hash
from app.services.embedding_service import embedding_service
from app.services.chunking_service import chunking_service

async def seed():
    print("Connecting to database...")
    engine = create_async_engine(settings.DATABASE_URL)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with session_maker() as db:
        # 1. Create Demo User
        user = User(
            id=uuid4(),
            email="demo@researchide.org",
            name="Dr. Alex Rivera",
            hashed_password=get_password_hash("password123")
        )
        db.add(user)
        await db.flush()
        print(f"Created User: {user.email}")

        # 2. Create Demo Project
        project = Project(
            id=uuid4(),
            user_id=user.id,
            name="Quantum Neural Architectures",
            description="Investigating parameterized quantum circuits for scalable scientific machine learning."
        )
        db.add(project)
        await db.flush()
        print(f"Created Project: {project.name}")

        # 3. Create Sample Papers
        paper1 = Paper(
            id=uuid4(),
            project_id=project.id,
            title="Attention Is All You Need",
            authors=[{"name": "Ashish Vaswani"}, {"name": "Noam Shazeer"}, {"name": "Niki Parmar"}],
            year=2017,
            arxiv_id="1706.03762",
            abstract="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
            s3_key=f"papers/{project.id}/sample_attention.pdf",
            file_size_bytes=2215000,
            page_count=15,
            parsing_status="completed"
        )
        db.add(paper1)
        await db.flush()

        # Sections for paper 1
        sec1 = PaperSection(
            paper_id=paper1.id,
            section_title="1. Introduction",
            section_index=0,
            start_page=1,
            end_page=2,
            content="Recurrent models typically factor computation along the symbol positions of the input and output sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden states h_t, as a function of the previous hidden state h_{t-1} and the input for position t. This inherently sequential nature precludes parallelization within training examples."
        )
        sec2 = PaperSection(
            paper_id=paper1.id,
            section_title="3.2 Scaled Dot-Product Attention",
            section_index=1,
            start_page=3,
            end_page=4,
            content="We call our particular attention 'Scaled Dot-Product Attention'. The input consists of queries and keys of dimension d_k, and values of dimension d_v. We compute the matrix of outputs as: Attention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V. We compute the attention function on a set of queries simultaneously, packed together into a matrix Q."
        )
        db.add_all([sec1, sec2])
        await db.flush()

        # Chunks for paper 1
        chunks_text = [
            ("3.2 Scaled Dot-Product Attention", 3, "Scaled Dot-Product Attention computes outputs as softmax(QK^T / sqrt(d_k))V. The scaling factor of 1/sqrt(d_k) prevents the dot products from growing excessively large for large dimensions, which would otherwise push the softmax into regions with vanishingly small gradients."),
            ("1. Introduction", 1, "The Transformer replaces recurrence entirely with multi-head self-attention mechanisms, allowing significant parallelization and reaching superior translation quality in as little as 12 hours of training on 8 P100 GPUs.")
        ]
        for s_title, p_num, c_text in chunks_text:
            emb = await embedding_service.get_embedding(c_text)
            chunk = PaperChunk(
                paper_id=paper1.id,
                project_id=project.id,
                section_title=s_title,
                page_number=p_num,
                chunk_index=0,
                chunk_text=c_text,
                token_count=len(c_text.split()),
                embedding=emb
            )
            db.add(chunk)

        # 4. Create Sample Dataset
        dataset = Dataset(
            id=uuid4(),
            project_id=project.id,
            name="quantum_circuit_benchmarks.csv",
            file_type="csv",
            s3_key=f"datasets/{project.id}/sample_benchmarks.csv",
            file_size_bytes=10240,
            row_count=120,
            column_count=5,
            column_info=[
                {"name": "qubits", "type": "int64", "sample_values": [4, 8, 16]},
                {"name": "circuit_depth", "type": "int64", "sample_values": [10, 25, 50]},
                {"name": "fidelity", "type": "float64", "sample_values": [0.985, 0.941, 0.887]},
                {"name": "shots", "type": "int64", "sample_values": [1024, 4096, 8192]},
                {"name": "noise_model", "type": "string", "sample_values": ["depolarizing", "thermal"]}
            ],
            summary_stats={"fidelity": {"mean": 0.932, "min": 0.821, "max": 0.994}}
        )
        db.add(dataset)

        # 5. Create Sample Draft
        draft = Draft(
            id=uuid4(),
            project_id=project.id,
            title="thesis_chapter_1.tex",
            content_type="latex",
            content="\\section{Theoretical Foundations}\n\nRecent advances in attention mechanisms \\cite{vaswani2017attention} have stimulated cross-disciplinary adoption in quantum variational algorithms.\n\n\\begin{equation}\n\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V\n\\end{equation}\n\nIn this chapter, we extend this formulation to unitary quantum gates."
        )
        db.add(draft)

        # 6. Create Initial Chat Session
        chat_sess = ChatSession(
            id=uuid4(),
            project_id=project.id,
            title="Transformer Scaling Queries"
        )
        db.add(chat_sess)
        await db.flush()

        msg1 = ChatMessage(
            session_id=chat_sess.id,
            role="user",
            content="Why does Scaled Dot-Product Attention divide by sqrt(d_k)?"
        )
        msg2 = ChatMessage(
            session_id=chat_sess.id,
            role="assistant",
            content="According to **Attention Is All You Need** ([Attention Is All You Need, 3.2 Scaled Dot-Product Attention, p. 3]), for large values of $d_k$, the dot products grow large in magnitude, pushing the softmax function into regions where it has extremely small gradients. To counteract this effect, the dot products are scaled by $\\frac{1}{\\sqrt{d_k}}$.",
            citations=[{
                "paper_id": str(paper1.id),
                "paper_title": paper1.title,
                "section": "3.2 Scaled Dot-Product Attention",
                "page": 3,
                "snippet": "We suspect that for large values of d_k, the dot products grow large in magnitude, pushing the softmax function into regions where it has extremely small gradients...",
                "score": 0.98,
                "data_source": "library"
            }]
        )
        db.add_all([msg1, msg2])

        await db.commit()
        print("Demo seed complete! Project ID:", project.id)

if __name__ == "__main__":
    asyncio.run(seed())
