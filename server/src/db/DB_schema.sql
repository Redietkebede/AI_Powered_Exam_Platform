--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

-- Started on 2025-08-27 08:52:45

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 5 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- TOC entry 5028 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 227 (class 1259 OID 32831)
-- Name: answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answers (
    id integer NOT NULL,
    session_id integer,
    question_id integer,
    selected_option character(1),
    correct_answer character(1),
    is_correct boolean,
    time_taken_seconds integer,
    question_difficulty integer,
    question_elo integer
);


--
-- TOC entry 226 (class 1259 OID 32830)
-- Name: answers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.answers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5029 (class 0 OID 0)
-- Dependencies: 226
-- Name: answers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.answers_id_seq OWNED BY public.answers.id;


--
-- TOC entry 225 (class 1259 OID 32812)
-- Name: exam_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_sessions (
    id integer NOT NULL,
    user_id integer,
    test_id integer,
    started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    finished_at timestamp without time zone,
    total_time_seconds integer,
    raw_score numeric(5,2),
    correct_answers integer,
    total_questions integer,
    final_elo_score integer DEFAULT 1200
);


--
-- TOC entry 224 (class 1259 OID 32811)
-- Name: exam_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5030 (class 0 OID 0)
-- Dependencies: 224
-- Name: exam_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_sessions_id_seq OWNED BY public.exam_sessions.id;


--
-- TOC entry 229 (class 1259 OID 32848)
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    id integer NOT NULL,
    user_id integer,
    session_id integer,
    action_type text,
    prompt text,
    model_used text,
    response_snippet text,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 228 (class 1259 OID 32847)
-- Name: logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5031 (class 0 OID 0)
-- Dependencies: 228
-- Name: logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.logs_id_seq OWNED BY public.logs.id;


--
-- TOC entry 221 (class 1259 OID 32784)
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id integer NOT NULL,
    topic text NOT NULL,
    question_text text NOT NULL,
    options jsonb NOT NULL,
    correct_answer integer NOT NULL,
    difficulty integer,
    tags text[],
    elo_rating integer DEFAULT 1200,
    created_at timestamp without time zone DEFAULT now(),
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp without time zone,
    published_by integer,
    deleted_at timestamp without time zone,
    explanation text[],
    CONSTRAINT correct_answer_range CHECK (((correct_answer >= 0) AND (correct_answer <= 3))),
    CONSTRAINT questions_correct_answer_chk CHECK (((correct_answer >= 0) AND (correct_answer <= 3))),
    CONSTRAINT questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
    CONSTRAINT questions_difficulty_chk CHECK (((difficulty >= 1) AND (difficulty <= 5))),
    CONSTRAINT questions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- TOC entry 220 (class 1259 OID 32783)
-- Name: questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5032 (class 0 OID 0)
-- Dependencies: 220
-- Name: questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.questions_id_seq OWNED BY public.questions.id;


--
-- TOC entry 231 (class 1259 OID 41076)
-- Name: session_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_questions (
    session_id integer NOT NULL,
    question_id integer NOT NULL,
    "position" integer
);


--
-- TOC entry 230 (class 1259 OID 41061)
-- Name: test_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_questions (
    test_id integer NOT NULL,
    question_id integer NOT NULL,
    "position" integer
);


--
-- TOC entry 223 (class 1259 OID 32796)
-- Name: tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tests (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    created_by integer,
    is_adaptive boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 222 (class 1259 OID 32795)
-- Name: tests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5033 (class 0 OID 0)
-- Dependencies: 222
-- Name: tests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tests_id_seq OWNED BY public.tests.id;


--
-- TOC entry 219 (class 1259 OID 32770)
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    email text,
    role character varying(20) DEFAULT 'candidate'::character varying NOT NULL,
    created_at time with time zone DEFAULT CURRENT_TIMESTAMP,
    firebase_uid text,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'editor'::character varying, 'recruiter'::character varying, 'candidate'::character varying])::text[])))
);


--
-- TOC entry 218 (class 1259 OID 32769)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5034 (class 0 OID 0)
-- Dependencies: 218
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- TOC entry 4830 (class 2604 OID 32834)
-- Name: answers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers ALTER COLUMN id SET DEFAULT nextval('public.answers_id_seq'::regclass);


--
-- TOC entry 4827 (class 2604 OID 32815)
-- Name: exam_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions ALTER COLUMN id SET DEFAULT nextval('public.exam_sessions_id_seq'::regclass);


--
-- TOC entry 4831 (class 2604 OID 32851)
-- Name: logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs ALTER COLUMN id SET DEFAULT nextval('public.logs_id_seq'::regclass);


--
-- TOC entry 4820 (class 2604 OID 32787)
-- Name: questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions ALTER COLUMN id SET DEFAULT nextval('public.questions_id_seq'::regclass);


--
-- TOC entry 4824 (class 2604 OID 32799)
-- Name: tests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests ALTER COLUMN id SET DEFAULT nextval('public.tests_id_seq'::regclass);


--
-- TOC entry 4817 (class 2604 OID 32773)
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- TOC entry 4857 (class 2606 OID 32836)
-- Name: answers answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_pkey PRIMARY KEY (id);


--
-- TOC entry 4855 (class 2606 OID 32819)
-- Name: exam_sessions exam_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions
    ADD CONSTRAINT exam_sessions_pkey PRIMARY KEY (id);


--
-- TOC entry 4859 (class 2606 OID 32856)
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);


--
-- TOC entry 4847 (class 2606 OID 32794)
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- TOC entry 4850 (class 2606 OID 41200)
-- Name: questions questions_topic_question_text_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_topic_question_text_key UNIQUE (topic, question_text);


--
-- TOC entry 4865 (class 2606 OID 41080)
-- Name: session_questions session_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_questions
    ADD CONSTRAINT session_questions_pkey PRIMARY KEY (session_id, question_id);


--
-- TOC entry 4862 (class 2606 OID 41065)
-- Name: test_questions test_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_pkey PRIMARY KEY (test_id, question_id);


--
-- TOC entry 4853 (class 2606 OID 32805)
-- Name: tests tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (id);


--
-- TOC entry 4841 (class 2606 OID 32782)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4844 (class 2606 OID 32780)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4845 (class 1259 OID 41130)
-- Name: idx_questions_topic_diff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_topic_diff ON public.questions USING btree (topic, difficulty);


--
-- TOC entry 4863 (class 1259 OID 41092)
-- Name: idx_session_questions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_questions_session ON public.session_questions USING btree (session_id);


--
-- TOC entry 4860 (class 1259 OID 41091)
-- Name: idx_test_questions_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_questions_test ON public.test_questions USING btree (test_id);


--
-- TOC entry 4848 (class 1259 OID 41189)
-- Name: questions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX questions_status_idx ON public.questions USING btree (status);


--
-- TOC entry 4851 (class 1259 OID 32877)
-- Name: uq_questions_text_diff; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_questions_text_diff ON public.questions USING btree (question_text, difficulty);


--
-- TOC entry 4839 (class 1259 OID 41060)
-- Name: uq_users_firebase_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_firebase_uid ON public.users USING btree (firebase_uid);


--
-- TOC entry 4842 (class 1259 OID 41160)
-- Name: users_firebase_uid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_firebase_uid_idx ON public.users USING btree (firebase_uid);


--
-- TOC entry 4870 (class 2606 OID 32842)
-- Name: answers answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- TOC entry 4871 (class 2606 OID 32837)
-- Name: answers answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_sessions(id);


--
-- TOC entry 4868 (class 2606 OID 32825)
-- Name: exam_sessions exam_sessions_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions
    ADD CONSTRAINT exam_sessions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id);


--
-- TOC entry 4869 (class 2606 OID 32820)
-- Name: exam_sessions exam_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sessions
    ADD CONSTRAINT exam_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4872 (class 2606 OID 32862)
-- Name: logs logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_sessions(id);


--
-- TOC entry 4873 (class 2606 OID 32857)
-- Name: logs logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4866 (class 2606 OID 41184)
-- Name: questions questions_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- TOC entry 4876 (class 2606 OID 41086)
-- Name: session_questions session_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_questions
    ADD CONSTRAINT session_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- TOC entry 4877 (class 2606 OID 41081)
-- Name: session_questions session_questions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_questions
    ADD CONSTRAINT session_questions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_sessions(id) ON DELETE CASCADE;


--
-- TOC entry 4874 (class 2606 OID 41071)
-- Name: test_questions test_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE;


--
-- TOC entry 4875 (class 2606 OID 41066)
-- Name: test_questions test_questions_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;


--
-- TOC entry 4867 (class 2606 OID 32806)
-- Name: tests tests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


-- Completed on 2025-08-27 08:52:45

--
-- PostgreSQL database dump complete
--

